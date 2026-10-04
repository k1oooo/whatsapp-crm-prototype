// Storing messages and keeping a lead's CRM fields up to date.
import type { SupabaseClient } from "@supabase/supabase-js";
import { extractLead, mergeLead, type ChatMessage, type LeadFields } from "@/lib/ai";
import { type WaText } from "@/lib/whatsapp/types";

// After the owner replies from their own phone, the assistant stays quiet in that chat for a while.
const PAUSE_MS = 12 * 60 * 60 * 1000;

export function bodyOf(m: { type: string; text?: WaText }): string {
  return m.type === "text" && m.text?.body ? m.text.body : `[${m.type}]`;
}

/** Store one message, creating or updating the lead. `duplicate` is true when Meta delivered it before. */
export async function recordMessage(
  db: SupabaseClient,
  args: {
    businessId: string;
    contactNumber: string;
    contactName?: string;
    direction: "in" | "out";
    waMessageId: string;
    body: string;
    sentAt: Date;
    source: "customer" | "owner";
  },
): Promise<{ leadId: string; duplicate: boolean }> {
  const { businessId, contactNumber, contactName, direction, waMessageId, body, sentAt, source } = args;
  const sentIso = sentAt.toISOString();

  // Find or create the lead.
  const { data: existing } = await db
    .from("leads")
    .select("id, name, last_message_at, last_inbound_at, last_outbound_at, last_chased_at, pending_decision")
    .eq("business_id", businessId)
    .eq("wa_contact_number", contactNumber)
    .maybeSingle();

  let leadId: string;
  if (existing) {
    leadId = existing.id;
  } else {
    const { data: created, error } = await db
      .from("leads")
      .insert({
        business_id: businessId,
        wa_contact_number: contactNumber,
        name: contactName ?? null,
      })
      .select("id")
      .single();

    if (created) {
      leadId = created.id;
    } else if (error?.code === "23505") {
      // Another message from the same customer created the lead a moment ago.
      const { data: again } = await db
        .from("leads")
        .select("id")
        .eq("business_id", businessId)
        .eq("wa_contact_number", contactNumber)
        .single();
      if (!again) throw error;
      leadId = again.id;
    } else {
      throw error ?? new Error("Could not create lead");
    }
  }

  // Insert the message. A unique violation means Meta retried the webhook.
  const { error: msgError } = await db.from("messages").insert({
    lead_id: leadId,
    business_id: businessId,
    wa_message_id: waMessageId,
    direction,
    body,
    sent_at: sentIso,
    source,
  });
  if (msgError) {
    if (msgError.code === "23505") return { leadId, duplicate: true };
    throw msgError;
  }

  // Keep the timestamps at the latest value even if messages arrive out of order.
  const later = (a: string | null | undefined, b: string) => (!a || new Date(a) < new Date(b) ? b : a);
  const update: Record<string, string | boolean> = {
    last_message_at: later(existing?.last_message_at, sentIso),
    updated_at: new Date().toISOString(),
  };
  if (direction === "in") update.last_inbound_at = later(existing?.last_inbound_at, sentIso);
  else update.last_outbound_at = later(existing?.last_outbound_at, sentIso);
  if (!existing?.name && contactName) update.name = contactName;

  // The owner is talking to this customer from their phone, so the assistant steps back for a while.
  if (direction === "out" && source === "owner") {
    update.bot_paused_until = new Date(Date.now() + PAUSE_MS).toISOString();
  }

  // You answered from the WhatsApp app, a while after the "let me check" message.
  if (
    direction === "out" &&
    existing?.pending_decision &&
    (!existing.last_chased_at ||
      new Date(sentIso).getTime() > new Date(existing.last_chased_at).getTime() + 120_000)
  ) {
    update.pending_decision = false;
  }

  await db.from("leads").update(update).eq("id", leadId);
  return { leadId, duplicate: false };
}

/** Merge new lead fields into the existing ones, never overwriting fields the owner corrected by hand. */
export function mergeWithLocks(
  lead: Record<string, unknown> & { locked_fields?: string[] | null },
  next: LeadFields,
): LeadFields {
  const merged = mergeLead(lead as Partial<LeadFields>, next);
  for (const field of lead.locked_fields ?? []) {
    (merged as unknown as Record<string, unknown>)[field] = lead[field];
  }
  return merged;
}

/** Re-read the recent chat, extract lead fields, and merge them into the lead. */
export async function refreshLead(db: SupabaseClient, leadId: string): Promise<void> {
  const { data: lead } = await db
    .from("leads")
    .select("name, need, budget_myr, quoted_price_myr, deadline, stage, language, locked_fields")
    .eq("id", leadId)
    .single();
  if (!lead) return;

  const { data: rows } = await db
    .from("messages")
    .select("direction, body, sent_at")
    .eq("lead_id", leadId)
    // created_at (our own clock) sorts first: WhatsApp's inbound sent_at is whole seconds, so
    // sorting by sent_at first can put an outbound reply's millisecond timestamp ahead of a
    // customer message that actually landed a moment later in the same second.
    .order("created_at", { ascending: false })
    .order("sent_at", { ascending: false })
    .limit(30);

  const messages: ChatMessage[] = [...(rows ?? [])]
    .reverse()
    .map((r) => ({ direction: r.direction, body: r.body ?? "", sentAt: r.sent_at }));

  const extracted = await extractLead(messages);

  // A lead nobody has answered yet is new, whatever the AI thinks.
  if (!messages.some((m) => m.direction === "out")) extracted.stage = "new";

  const merged = mergeWithLocks(lead, extracted);

  await db
    .from("leads")
    .update({ ...merged, updated_at: new Date().toISOString() })
    .eq("id", leadId);
}
