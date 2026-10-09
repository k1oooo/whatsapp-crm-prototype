import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase } from "@/test/fake-supabase";

let db: ReturnType<typeof createFakeSupabase>;
const retrieve = vi.fn();
let eventToReturn: unknown;

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => db }));
vi.mock("@/lib/stripe", () => ({
  stripe: () => ({
    webhooks: { constructEvent: () => eventToReturn },
    subscriptions: { retrieve },
  }),
}));

import { POST } from "@/app/api/stripe/webhook/route";

const sub = (status: string) => ({
  id: "sub_1",
  status,
  customer: "cus_1",
  metadata: { business_id: "biz-1" },
  trial_end: null,
  items: { data: [{ current_period_end: 1900000000 }] },
});

const call = () =>
  POST(new Request("http://x/api/stripe/webhook", { method: "POST", body: "{}", headers: { "stripe-signature": "t" } }) as never);

beforeEach(() => {
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
  db = createFakeSupabase({ subscriptions: [] });
  retrieve.mockReset();
});

describe("stripe webhook", () => {
  it("REGRESSION: a late 'updated' event cannot bring back a subscription Stripe now reports as canceled", async () => {
    eventToReturn = { type: "customer.subscription.updated", data: { object: sub("active") } };
    retrieve.mockResolvedValue(sub("canceled"));
    expect((await call()).status).toBe(200);
    expect(db._db.subscriptions[0].status).toBe("canceled");
  });

  it("uses the event payload when Stripe no longer has the subscription", async () => {
    eventToReturn = { type: "customer.subscription.deleted", data: { object: sub("canceled") } };
    retrieve.mockRejectedValue(Object.assign(new Error("gone"), { code: "resource_missing" }));
    expect((await call()).status).toBe(200);
    expect(db._db.subscriptions[0].status).toBe("canceled");
  });

  it("answers 500 on any other Stripe failure so Stripe retries the event", async () => {
    eventToReturn = { type: "customer.subscription.updated", data: { object: sub("active") } };
    retrieve.mockRejectedValue(new Error("network"));
    expect((await call()).status).toBe(500);
    expect(db._db.subscriptions).toHaveLength(0);
  });
});
