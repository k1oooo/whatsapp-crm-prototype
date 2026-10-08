// Cost guards for AI calls: the subscription must be active, and a business can only use so much
// per day. Without a daily cap, one trial account (and signing up is free) could run up the AI bill.
import type { SupabaseClient } from "@supabase/supabase-js";
import { isSubscriptionActive, subscriptionBlockedNote, type SubscriptionInfo } from "@/lib/subscriptions";

const DEFAULT_DAILY_MESSAGE_LIMIT = 1000;

/** Messages (both directions) one business may have in 24 hours before the assistant pauses. Set AI_DAILY_MESSAGE_LIMIT to change it. */
export function dailyMessageLimit(): number {
  const n = Number(process.env.AI_DAILY_MESSAGE_LIMIT);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_DAILY_MESSAGE_LIMIT;
}

export const DAILY_LIMIT_NOTE =
  "The assistant paused: this business reached its daily limit of AI messages. Reply yourself, or it resumes within 24 hours.";

/** True when the business has used up today's allowance. A failed count lets the call through, so an outage never stops replies. */
export async function overDailyLimit(db: SupabaseClient, businessId: string): Promise<boolean> {
  const since = new Date(Date.now() - 86_400_000).toISOString();
  const { count, error } = await db
    .from("messages")
    .select("id", { count: "exact", head: true })
    .eq("business_id", businessId)
    .gte("created_at", since);
  if (error) {
    console.error("Could not check the daily AI limit", businessId, error.message);
    return false;
  }
  return (count ?? 0) >= dailyMessageLimit();
}

/**
 * Whether an owner who clicked a button that calls the AI (answer a handover, confirm a payment) may do it.
 * Returns the message to show them, or null when it is fine. Runs as the signed-in owner, so row level
 * security still decides which business and subscription they can see.
 */
export async function ownerAiBlock(db: SupabaseClient, businessId: string): Promise<string | null> {
  const { data: subscription } = await db
    .from("subscriptions")
    .select("status, trial_ends_at, current_period_end")
    .eq("business_id", businessId)
    .maybeSingle();
  const sub = (subscription as SubscriptionInfo | null) ?? null;
  if (!isSubscriptionActive(sub)) return subscriptionBlockedNote(sub);
  if (await overDailyLimit(db, businessId)) return DAILY_LIMIT_NOTE;
  return null;
}

/** Flag a chat once so the owner sees why the assistant stayed quiet. Does nothing if it is already flagged. */
export async function flagDailyLimit(db: SupabaseClient, leadId: string): Promise<void> {
  const { data: current } = await db.from("leads").select("pending_decision").eq("id", leadId).maybeSingle();
  if (!current || current.pending_decision) return;
  const { error } = await db
    .from("leads")
    .update({
      pending_decision: true,
      human_reason: "unsure",
      handoff_note: DAILY_LIMIT_NOTE,
      updated_at: new Date().toISOString(),
    })
    .eq("id", leadId);
  if (error) console.error("Could not flag the lead as over the daily limit", leadId, error.message);
}
