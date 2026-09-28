import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";
import type { SubscriptionStatus } from "@/lib/subscriptions";

const KNOWN_STATUSES: readonly SubscriptionStatus[] = ["trialing", "active", "past_due", "canceled", "incomplete"];

export function mapStatus(status: Stripe.Subscription.Status): SubscriptionStatus {
  // Stripe also has "unpaid", "incomplete_expired", and "paused". None of those mean "let the
  // assistant keep replying", so they all fall through to the most restrictive status we track.
  return (KNOWN_STATUSES as readonly string[]).includes(status) ? (status as SubscriptionStatus) : "incomplete";
}

/**
 * Save what Stripe says about a subscription into our subscriptions table. Called from the
 * Stripe webhook; kept out of the route file so it can be tested without an HTTP request.
 */
export async function syncSubscription(admin: SupabaseClient, sub: Stripe.Subscription): Promise<void> {
  const businessId = sub.metadata?.business_id;
  if (!businessId) {
    // Set on checkout (see app/dashboard/billing/actions.ts subscription_data.metadata). Every
    // subscription this app creates has it; one that doesn't isn't ours to act on.
    console.error("Stripe subscription has no business_id metadata, ignoring", sub.id);
    return;
  }

  // Events can arrive out of order. If this owner cancelled and then subscribed again, a late
  // "deleted" for the OLD subscription must not overwrite the NEW live one and lock them out.
  // Only a different subscription reporting it has ended is ignored: a different subscription
  // that is live still replaces the row, which is how a re-subscribe takes over.
  const status = mapStatus(sub.status);
  const { data: existing } = await admin
    .from("subscriptions")
    .select("stripe_subscription_id")
    .eq("business_id", businessId)
    .maybeSingle();
  if (existing?.stripe_subscription_id && existing.stripe_subscription_id !== sub.id && status === "canceled") {
    return;
  }

  // Since Stripe's 2025 API versions, the billing period lives per subscription item (a
  // subscription can mix items with different cycles) rather than on the subscription itself.
  // This plan only ever has one item, so the first one's period is the subscription's period.
  const periodEnd = sub.items.data[0]?.current_period_end;

  const { error } = await admin.from("subscriptions").upsert(
    {
      business_id: businessId,
      stripe_customer_id: typeof sub.customer === "string" ? sub.customer : sub.customer.id,
      stripe_subscription_id: sub.id,
      status,
      trial_ends_at: sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null,
      current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "business_id" },
  );
  if (error) console.error("Could not save subscription from webhook", sub.id, error.message);
}
