export type SubscriptionStatus = "trialing" | "active" | "past_due" | "canceled" | "incomplete";

export interface SubscriptionInfo {
  status: SubscriptionStatus;
  trial_ends_at: string | null;
  current_period_end: string | null;
}

/**
 * Whether the assistant is allowed to reply for this business right now.
 *
 * 'active' always counts. 'trialing' counts only while trial_ends_at is still in the future —
 * Stripe flips a subscribed business off 'trialing' on its own via the webhook, but a business
 * that never subscribed at all just sits at 'trialing' forever unless this checks the date too.
 * Everything else (past_due, canceled, incomplete) is blocked: no half-working state where
 * replies keep going out after a card has failed.
 */
export function isSubscriptionActive(sub: SubscriptionInfo | null | undefined): boolean {
  if (!sub) return false;
  if (sub.status === "active") return true;
  if (sub.status === "trialing") return !sub.trial_ends_at || new Date(sub.trial_ends_at) > new Date();
  return false;
}

/** A short, owner-facing reason the assistant stopped, for the handoff note. */
export function subscriptionBlockedNote(sub: SubscriptionInfo | null | undefined): string {
  if (!sub || sub.status === "trialing") {
    return "Your 14-day trial has ended. Subscribe in Billing to let the assistant reply automatically again.";
  }
  if (sub.status === "past_due") {
    return "Your last payment did not go through. Update your card in Billing to resume automatic replies.";
  }
  return "Your subscription is not active. Subscribe in Billing to let the assistant reply automatically again.";
}

/** Whole days left on an unexpired, unconverted trial, or null when this isn't one. */
export function trialDaysLeft(sub: SubscriptionInfo | null | undefined): number | null {
  if (!sub || sub.status !== "trialing" || !sub.trial_ends_at || !isSubscriptionActive(sub)) return null;
  return Math.max(0, Math.ceil((new Date(sub.trial_ends_at).getTime() - Date.now()) / 86_400_000));
}
