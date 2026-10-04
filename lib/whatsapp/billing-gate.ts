// Billing gate for the assistant.
import type { SupabaseClient } from "@supabase/supabase-js";
import { isSubscriptionActive, subscriptionBlockedNote } from "@/lib/subscriptions";
import { type BusinessInfo } from "@/lib/whatsapp/types";

/**
 * Billing gate for the assistant. Every AI call (the reply, and the lead-field extraction) costs money,
 * so none of it runs while the subscription is not active. Returns true when the chat is blocked.
 */
export async function blockedByBilling(db: SupabaseClient, business: BusinessInfo, leadId: string): Promise<boolean> {
  if (isSubscriptionActive(business.subscription)) return false;

  // Only tell the owner why if they actually wanted the assistant on. A business that never
  // turned it on isn't missing anything, so flagging every new lead "billing" would be noise.
  if (business.auto_reply) {
    const { data: current } = await db.from("leads").select("pending_decision").eq("id", leadId).maybeSingle();
    // Flag once, not on every message, so the note isn't rewritten while they decide.
    if (current && !current.pending_decision) {
      const { error } = await db
        .from("leads")
        .update({
          pending_decision: true,
          human_reason: "billing",
          handoff_note: subscriptionBlockedNote(business.subscription),
          updated_at: new Date().toISOString(),
        })
        .eq("id", leadId);
      if (error) console.error("Could not flag the lead as blocked by billing", leadId, error.message);
    }
  }
  return true;
}
