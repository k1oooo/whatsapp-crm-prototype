// The webhook's half: store every message in a verified payload and queue work. Nothing slow happens here.
import type { SupabaseClient } from "@supabase/supabase-js";
import { enqueueInbound, isQueueUnavailable, type InlineJob } from "@/lib/inbound-queue";
import { type WaWebhookPayload } from "@/lib/whatsapp/types";
import { bodyOf, recordMessage } from "@/lib/whatsapp/lead";

/** True when this inbound message is still the newest in the chat, so nobody has answered it. */
async function stillUnanswered(db: SupabaseClient, leadId: string, waMessageId: string): Promise<boolean> {
  const { data } = await db
    .from("messages")
    .select("wa_message_id, direction")
    .eq("lead_id", leadId)
    .order("created_at", { ascending: false })
    .order("sent_at", { ascending: false })
    .limit(1);
  const newest = data?.[0];
  return !!newest && newest.direction === "in" && newest.wa_message_id === waMessageId;
}

let warnedQueueMissing = false;
export function warnQueueMissing() {
  if (warnedQueueMissing) return;
  warnedQueueMissing = true;
  console.error(
    "The inbound_jobs table is missing, so messages are answered inside the webhook with no retries. Run supabase/migrations/0015_reliability.sql.",
  );
}

/** Queue the chat. If the queue does not exist (migration 0015 not applied), hand it back to be handled directly. */
async function queueOrInline(db: SupabaseClient, businessId: string, leadId: string, inline: InlineJob[]) {
  try {
    await enqueueInbound(db, businessId, leadId);
  } catch (err) {
    if (!isQueueUnavailable(err)) throw err;
    warnQueueMissing();
    if (!inline.some((j) => j.lead_id === leadId)) inline.push({ business_id: businessId, lead_id: leadId });
  }
}

/**
 * The webhook's job: store every message in a verified payload and queue work for the chats it
 * touched. Nothing slow happens here (no AI, no sending), so it finishes well inside Meta's timeout.
 * If it throws, the route answers 500 and Meta redelivers: messages are deduplicated, and a
 * redelivered message that nobody has answered yet is queued again.
 *
 * Returns the chats to handle directly. That list is empty unless the queue table is missing.
 */
export async function ingestPayload(db: SupabaseClient, payload: WaWebhookPayload): Promise<{ inline: InlineJob[] }> {
  const inline: InlineJob[] = [];
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      const phoneNumberId = value.metadata?.phone_number_id;
      if (!phoneNumberId) continue;

      const { data: business, error } = await db
        .from("businesses")
        .select("id")
        .eq("wa_phone_number_id", phoneNumberId)
        .maybeSingle();
      if (error) throw error;
      if (!business) {
        console.warn(`No business registered for phone_number_id ${phoneNumberId}`);
        continue;
      }

      if (change.field === "messages") {
        for (const m of value.messages ?? []) {
          const name = value.contacts?.find((c) => c.wa_id === m.from)?.profile?.name;
          const { leadId, duplicate } = await recordMessage(db, {
            businessId: business.id,
            contactNumber: m.from,
            contactName: name,
            direction: "in",
            waMessageId: m.id,
            body: bodyOf(m),
            sentAt: new Date(Number(m.timestamp) * 1000),
            source: "customer",
          });
          if (!duplicate || (await stillUnanswered(db, leadId, m.id))) {
            await queueOrInline(db, business.id, leadId, inline);
          }
        }
      }

      if (change.field === "smb_message_echoes") {
        for (const e of value.message_echoes ?? []) {
          const { leadId, duplicate } = await recordMessage(db, {
            businessId: business.id,
            contactNumber: e.to,
            direction: "out",
            waMessageId: e.id,
            body: bodyOf(e),
            sentAt: new Date(Number(e.timestamp) * 1000),
            source: "owner",
          });
          if (!duplicate) await queueOrInline(db, business.id, leadId, inline);
        }
      }
    }
  }
  return { inline };
}
