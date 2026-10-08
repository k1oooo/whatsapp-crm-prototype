// The worker's half: act on one chat from the queue.
import type { SupabaseClient } from "@supabase/supabase-js";
import { drainInboundJobs, isQueueUnavailable, type InboundJob, type InlineJob } from "@/lib/inbound-queue";
import { type BusinessInfo, type WaWebhookPayload } from "@/lib/whatsapp/types";
import { refreshLead } from "@/lib/whatsapp/lead";
import { autoReply } from "@/lib/whatsapp/agent";
import { handleFollowUpReply } from "@/lib/whatsapp/followup-replies";
import { flagDailyLimit, overDailyLimit } from "@/lib/ai-guard";
import { blockedByBilling } from "@/lib/whatsapp/billing-gate";
import { ingestPayload, warnQueueMissing } from "@/lib/whatsapp/ingest";

/** Decide what to do with a lead after new messages arrived. */
export async function handleLead(db: SupabaseClient, business: BusinessInfo, leadId: string): Promise<void> {
  // STOP and consent replies are honoured regardless of billing: they cost nothing (no AI call)
  // and ignoring an opt-out because a card lapsed would be wrong.
  if (await handleFollowUpReply(db, business, leadId)) return;

  // Every AI call below costs money, so none of it runs while the subscription is not active.
  if (await blockedByBilling(db, business, leadId)) return;

  // A daily cap per business, so one account cannot run up the AI bill.
  if (await overDailyLimit(db, business.id)) {
    if (business.auto_reply) await flagDailyLimit(db, leadId);
    return;
  }

  const { data: lead } = await db
    .from("leads")
    .select("pending_decision, bot_paused_until")
    .eq("id", leadId)
    .single();

  const paused = !!lead?.bot_paused_until && new Date(lead.bot_paused_until) > new Date();
  const canAutoReply = business.auto_reply && !!lead && !lead.pending_decision && !paused;

  if (canAutoReply && (await autoReply(db, business, leadId))) return;

  // Reading the chat into CRM fields is best effort. If the AI is down, a retry of the whole job would
  // not help the customer, so log it and move on (the next message tries again).
  try {
    await refreshLead(db, leadId);
  } catch (err) {
    console.error("Could not update the lead details", leadId, err);
  }
}

/** The worker's job: act on one chat. Throws when it should be retried. */
export async function handleInboundJob(db: SupabaseClient, job: Pick<InboundJob, "business_id" | "lead_id">): Promise<void> {
  const { data: business, error } = await db
    .from("businesses")
    .select("id, wa_phone_number_id, auto_reply, reply_mode, business_facts, tone_notes, wa_access_token")
    .eq("id", job.business_id)
    .maybeSingle();
  if (error) throw error;
  if (!business) return; // the business was deleted: nothing left to do

  // Missing row (pre-migration-0012 data, or the trial insert having failed) is treated as "no active
  // subscription", not as "let it through": access needs an explicit active/trialing row.
  const { data: subscription } = await db
    .from("subscriptions")
    .select("status, trial_ends_at, current_period_end")
    .eq("business_id", business.id)
    .maybeSingle();

  await handleLead(db, { ...business, subscription } as BusinessInfo, job.lead_id);
}

/**
 * Do the work the webhook left behind: chats handed back because the queue table is missing (handled
 * once, with no retries, as before the queue existed), then whatever is due in the queue. A missing
 * queue is not an error here, it is a setup step that has not been done yet.
 */
export async function runInboundWork(
  db: SupabaseClient,
  inline: InlineJob[] = [],
  options: { limit?: number; budgetMs?: number } = {},
): Promise<{ done: number; retried: number; failed: number }> {
  for (const job of inline) {
    try {
      await handleInboundJob(db, job);
    } catch (err) {
      console.error("Could not handle a chat directly", job.lead_id, err);
    }
  }
  try {
    return await drainInboundJobs(db, (job) => handleInboundJob(db, job), options);
  } catch (err) {
    if (!isQueueUnavailable(err)) throw err;
    warnQueueMissing();
    return { done: 0, retried: 0, failed: 0 };
  }
}

/**
 * Store a payload and work through the queue right away. Production splits these (the webhook
 * ingests, then a background worker drains the queue); this keeps the simulator and tests simple.
 */
export async function processPayload(db: SupabaseClient, payload: WaWebhookPayload): Promise<void> {
  const { inline } = await ingestPayload(db, payload);
  await runInboundWork(db, inline, { limit: 20, budgetMs: 120_000 });
}
