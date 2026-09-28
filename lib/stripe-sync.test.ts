import type Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";
import { mapStatus, reconcileCheckoutSession, syncSubscription } from "@/lib/stripe-sync";
import { isSubscriptionActive, type SubscriptionInfo } from "@/lib/subscriptions";
import { createFakeSupabase } from "@/test/fake-supabase";

const unix = (d: Date) => Math.floor(d.getTime() / 1000);
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000);

/** Just the parts of a Stripe subscription that syncSubscription reads. */
function stripeSub(over: Partial<{
  id: string;
  status: Stripe.Subscription.Status;
  businessId: string | null;
  customer: string;
  trialEnd: number | null;
  periodEnd: number;
}> = {}): Stripe.Subscription {
  const o = { id: "sub_1", status: "active" as Stripe.Subscription.Status, businessId: "biz-1", customer: "cus_1", trialEnd: null, periodEnd: unix(inDays(30)), ...over };
  return {
    id: o.id,
    status: o.status,
    customer: o.customer,
    trial_end: o.trialEnd,
    metadata: o.businessId ? { business_id: o.businessId } : {},
    items: { data: [{ current_period_end: o.periodEnd }] },
  } as unknown as Stripe.Subscription;
}

function dbWithTrial() {
  return createFakeSupabase({
    subscriptions: [{ business_id: "biz-1", status: "trialing", trial_ends_at: inDays(5).toISOString() }],
  });
}

describe("mapStatus", () => {
  it.each(["trialing", "active", "past_due", "canceled", "incomplete"] as const)("keeps %s", (s) => {
    expect(mapStatus(s)).toBe(s);
  });

  it.each(["unpaid", "incomplete_expired", "paused"] as const)("treats %s as not active", (s) => {
    expect(isSubscriptionActive({ status: mapStatus(s), trial_ends_at: null, current_period_end: null })).toBe(false);
  });
});

describe("syncSubscription", () => {
  it("turns a local trial into a paid subscription after checkout", async () => {
    const db = dbWithTrial();
    await syncSubscription(db, stripeSub());

    expect(db._db.subscriptions).toHaveLength(1);
    const row = db._db.subscriptions[0];
    expect(row.status).toBe("active");
    expect(row.stripe_customer_id).toBe("cus_1");
    expect(row.stripe_subscription_id).toBe("sub_1");
    expect(row.current_period_end).toBeTruthy();
    expect(isSubscriptionActive(row as unknown as SubscriptionInfo)).toBe(true);
  });

  it("locks the assistant out when a payment fails", async () => {
    const db = dbWithTrial();
    await syncSubscription(db, stripeSub());
    await syncSubscription(db, stripeSub({ status: "past_due" }));
    expect(isSubscriptionActive(db._db.subscriptions[0] as unknown as SubscriptionInfo)).toBe(false);
  });

  it("ignores a subscription that has no business_id metadata", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const db = dbWithTrial();
    await syncSubscription(db, stripeSub({ businessId: null }));
    expect(db._db.subscriptions[0].status).toBe("trialing");
    expect(db._db.subscriptions[0].stripe_subscription_id).toBeUndefined();
    errors.mockRestore();
  });

  it("does not let a late 'canceled' for an old subscription overwrite a newer live one", async () => {
    const db = dbWithTrial();
    await syncSubscription(db, stripeSub({ id: "sub_old", status: "canceled" }));
    // The customer re-subscribed and the new subscription is live...
    await syncSubscription(db, stripeSub({ id: "sub_new", status: "active" }));
    // ...then Stripe delivers the old subscription's cancellation late.
    await syncSubscription(db, stripeSub({ id: "sub_old", status: "canceled" }));

    const row = db._db.subscriptions[0];
    expect(row.stripe_subscription_id).toBe("sub_new");
    expect(row.status).toBe("active");
  });

  it("does let a re-subscribe replace a cancelled subscription", async () => {
    const db = dbWithTrial();
    await syncSubscription(db, stripeSub({ id: "sub_old", status: "canceled" }));
    await syncSubscription(db, stripeSub({ id: "sub_new", status: "active" }));
    expect(db._db.subscriptions[0].stripe_subscription_id).toBe("sub_new");
    expect(isSubscriptionActive(db._db.subscriptions[0] as unknown as SubscriptionInfo)).toBe(true);
  });

  it("does mark the current subscription cancelled when it is the one that ended", async () => {
    const db = dbWithTrial();
    await syncSubscription(db, stripeSub({ id: "sub_1", status: "active" }));
    await syncSubscription(db, stripeSub({ id: "sub_1", status: "canceled" }));
    expect(db._db.subscriptions[0].status).toBe("canceled");
  });

  it("stores no period end rather than crashing when the subscription has no items", async () => {
    const db = dbWithTrial();
    const sub = stripeSub();
    (sub as unknown as { items: { data: unknown[] } }).items = { data: [] };
    await syncSubscription(db, sub);
    expect(db._db.subscriptions[0].current_period_end).toBeNull();
    expect(db._db.subscriptions[0].status).toBe("active");
  });
});

describe("reconcileCheckoutSession", () => {
  const session = (over: Partial<Stripe.Checkout.Session> = {}) =>
    ({ client_reference_id: "biz-1", status: "complete", subscription: "sub_1", ...over }) as Stripe.Checkout.Session;

  const reader = (s: Stripe.Checkout.Session, sub: Stripe.Subscription = stripeSub()) => ({
    checkout: { sessions: { retrieve: async () => s } },
    subscriptions: { retrieve: async () => sub },
  });

  it("activates the business straight from Stripe, without waiting for the webhook", async () => {
    const db = dbWithTrial();
    const ok = await reconcileCheckoutSession(db, reader(session()), "cs_1", "biz-1");
    expect(ok).toBe(true);
    expect(db._db.subscriptions[0].status).toBe("active");
    expect(isSubscriptionActive(db._db.subscriptions[0] as unknown as SubscriptionInfo)).toBe(true);
  });

  it("refuses a checkout session that was created for a different business", async () => {
    const db = dbWithTrial();
    const ok = await reconcileCheckoutSession(db, reader(session({ client_reference_id: "someone-else" })), "cs_1", "biz-1");
    expect(ok).toBe(false);
    expect(db._db.subscriptions[0].status).toBe("trialing");
  });

  it("refuses a subscription whose metadata points at a different business", async () => {
    const db = dbWithTrial();
    const ok = await reconcileCheckoutSession(db, reader(session(), stripeSub({ businessId: "someone-else" })), "cs_1", "biz-1");
    expect(ok).toBe(false);
    expect(db._db.subscriptions[0].status).toBe("trialing");
  });

  it("does nothing for a checkout that was abandoned", async () => {
    const db = dbWithTrial();
    const ok = await reconcileCheckoutSession(db, reader(session({ status: "open", subscription: null })), "cs_1", "biz-1");
    expect(ok).toBe(false);
    expect(db._db.subscriptions[0].status).toBe("trialing");
  });

  it("is harmless to run twice", async () => {
    const db = dbWithTrial();
    await reconcileCheckoutSession(db, reader(session()), "cs_1", "biz-1");
    await reconcileCheckoutSession(db, reader(session()), "cs_1", "biz-1");
    expect(db._db.subscriptions).toHaveLength(1);
    expect(db._db.subscriptions[0].status).toBe("active");
  });
});
