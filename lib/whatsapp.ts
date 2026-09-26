// WhatsApp Cloud API helpers: signature check, payload types, and message ingestion.
import crypto from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  HOLDING_FALLBACK,
  extractLead,
  mergeLead,
  runAgent,
  runFeedbackAgent,
  hasPlaceholder,
  usesUnknownAmount,
  type AgentResult,
  type OrderStatus,
  type ChatMessage,
  type LeadFields,
} from "@/lib/ai";
import { readSettings } from "@/lib/follow-up-settings";
import { getBusinessFacts } from "@/lib/knowledge";
import { sendWhatsAppText } from "@/lib/send";

interface BusinessInfo {
  id: string;
  wa_phone_number_id: string;
  auto_reply: boolean;
  business_facts: string | null;
  tone_notes: string | null;
  wa_access_token: string | null;
}

// After the owner replies from their own phone, the assistant stays quiet in that chat for a while.
const PAUSE_MS = 12 * 60 * 60 * 1000;

/* ---------- Payload types (only the fields we use) ---------- */

interface WaText {
  body: string;
}

interface WaInboundMessage {
  from: string; // customer wa_id
  id: string;
  timestamp: string; // unix seconds
  type: string;
  text?: WaText;
}

// Sent from the WhatsApp Business app on the owner's phone (coexistence).
interface WaEcho {
  from: string; // business number
  to: string; // customer wa_id
  id: string;
  timestamp: string;
  type: string;
  text?: WaText;
}

interface WaChangeValue {
  metadata?: { phone_number_id?: string; display_phone_number?: string };
  contacts?: { wa_id: string; profile?: { name?: string } }[];
  messages?: WaInboundMessage[];
  message_echoes?: WaEcho[];
}

export interface WaWebhookPayload {
  object?: string;
  entry?: { id: string; changes?: { field: string; value: WaChangeValue }[] }[];
}

/* ---------- Signature verification ---------- */

// The secret is resolved by the caller: it may be a business's own wa_app_secret (their own Meta
// app), or the deployment's shared WHATSAPP_APP_SECRET for businesses that don't have their own.
export function verifySignature(rawBody: string, header: string | null, secret: string | undefined): boolean {
  if (!secret || !header?.startsWith("sha256=")) return false;

  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const received = header.slice("sha256=".length);

  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(received, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/* ---------- Ingestion ---------- */

function bodyOf(m: { type: string; text?: WaText }): string {
  return m.type === "text" && m.text?.body ? m.text.body : `[${m.type}]`;
}

/** Store one message, creating or updating the lead. Returns the lead id, or null for a duplicate. */
async function recordMessage(
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
): Promise<string | null> {
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
    if (msgError.code === "23505") return null;
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
  return leadId;
}

/** Merge new lead fields into the existing ones, never overwriting fields the owner corrected by hand. */
function mergeWithLocks(
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
    .order("sent_at", { ascending: false })
    .order("created_at", { ascending: false })
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

/**
 * Answer the customer's latest message automatically, or hand the chat to the owner.
 * Returns false when there is nothing waiting for an answer.
 */
async function autoReply(db: SupabaseClient, business: BusinessInfo, leadId: string): Promise<boolean> {
  const { data: lead } = await db
    .from("leads")
    .select("wa_contact_number, name, need, budget_myr, quoted_price_myr, deadline, stage, language, locked_fields")
    .eq("id", leadId)
    .single();
  if (!lead) return false;

  // Order progress lives in its own columns, so the assistant still works if 0006 has not been run yet.
  const { data: orderRow } = await db
    .from("leads")
    .select("order_status, order_summary")
    .eq("id", leadId)
    .maybeSingle();

  const { data: rows } = await db
    .from("messages")
    .select("direction, body, sent_at, source")
    .eq("lead_id", leadId)
    .order("sent_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(30);

  const newest = rows?.[0];
  if (!newest || newest.direction !== "in") return false;

  const messages: ChatMessage[] = [...(rows ?? [])]
    .reverse()
    .map((r) => ({ direction: r.direction, body: r.body ?? "", sentAt: r.sent_at, source: r.source }));

  const current: LeadFields = {
    name: lead.name,
    need: lead.need,
    budget_myr: lead.budget_myr,
    quoted_price_myr: lead.quoted_price_myr,
    deadline: lead.deadline,
    stage: lead.stage,
    language: lead.language,
  };

  const handOver = async (reason: string, note: string) => {
    const { error } = await db
      .from("leads")
      .update({ pending_decision: true, human_reason: reason, updated_at: new Date().toISOString() })
      .eq("id", leadId);
    if (error) console.error("Could not flag the lead for the owner", leadId, error.message);
    const { error: noteError } = await db.from("leads").update({ handoff_note: note }).eq("id", leadId);
    if (noteError) console.error("Could not save the handoff note (is migration 0005 applied?)", noteError.message);
  };

  // Photos, voice notes and documents are usually payment proof or something the AI cannot read.
  const body = (newest.body ?? "").trim();
  const isMedia = /^\[[a-z_]+\]$/.test(body);

  // Read the knowledge base once. It is the only source of truth the assistant may quote from.
  const facts = isMedia ? "" : await getBusinessFacts(db, business.id);

  let result: AgentResult;
  if (isMedia) {
    result = {
      action: "escalate",
      reason: body === "[image]" || body === "[document]" ? "payment" : "unsure",
      reply: HOLDING_FALLBACK,
      order: { status: "none", summary: null },
      note:
        body === "[image]" || body === "[document]"
          ? "The customer sent a photo or file, possibly a payment receipt. Please check."
          : "The customer sent a voice note or media the assistant cannot read.",
      lead: current,
    };
  } else {
    try {
      result = await runAgent({
        facts,
        toneNotes: business.tone_notes,
        lead: current,
        order: {
          status: (orderRow?.order_status as OrderStatus | null) ?? "none",
          summary: orderRow?.order_summary ?? null,
        },
        messages,
      });
    } catch (err) {
      // Better to stay silent and tell the owner than to send a broken message.
      console.error("Auto-reply AI failed", leadId, err);
      await handOver("unsure", "The assistant could not answer (the AI was unavailable). Please reply.");
      return true;
    }
  }

  // Safety net: no invented prices, and no empty replies.
  const allowed = `${facts}\n${messages.map((m) => m.body).join("\n")}`;
  if (result.action === "reply" && hasPlaceholder(result.reply)) {
    result = {
      ...result,
      action: "escalate",
      reason: "unsure",
      reply: HOLDING_FALLBACK,
      order: { status: "none", summary: null },
      note: "Your Settings still have a placeholder like [BANK NAME]. Please finish them, then answer this customer.",
    };
  } else if (result.action === "reply" && (!result.reply || usesUnknownAmount(result.reply, allowed))) {
    result = {
      ...result,
      action: "escalate",
      reason: "unsure",
      reply: HOLDING_FALLBACK,
      order: { status: "none", summary: null },
      note: "The assistant's reply had a price it could not verify. Please check the chat.",
    };
  }
  if (!result.reply) result.reply = HOLDING_FALLBACK;

  // The customer confirmed the order. The system, not the AI, adds the bank details,
  // so the account number is always copied exactly.
  const previousOrder = orderRow?.order_status ?? null;
  // Only the first confirmation sends bank details. A later "thank you" must not repeat them.
  if (
    result.action === "reply" &&
    result.order.status === "confirmed" &&
    previousOrder !== "confirmed" &&
    previousOrder !== "paid"
  ) {
    const details = await getPaymentDetails(db, business.id);
    if (!details || hasPlaceholder(details)) {
      result = {
        ...result,
        action: "escalate",
        reason: "unsure",
        reply: HOLDING_FALLBACK,
        order: { status: "awaiting_confirmation", summary: result.order.summary },
        note: "A customer confirmed their order but your payment details are missing or unfinished in Settings. Add them, then send them to this customer.",
      };
    } else {
      result = { ...result, reply: `${result.reply}\n\n${details}` };
    }
  }

  // Someone else (the owner, or an earlier webhook) may have answered in the meantime.
  const { data: newer } = await db
    .from("messages")
    .select("id")
    .eq("lead_id", leadId)
    .eq("direction", "out")
    .gt("sent_at", newest.sent_at)
    .limit(1);
  if (newer && newer.length > 0) return true;

  // When handing over, flag the lead BEFORE telling the customer we will check. If the flag
  // cannot be saved, stay silent rather than promise something the owner will never see.
  const nowIso = new Date().toISOString();
  if (result.action === "escalate") {
    const { error: flagError } = await db
      .from("leads")
      .update({
        pending_decision: true,
        human_reason: result.reason ?? "unsure",
        last_chased_at: nowIso,
        updated_at: nowIso,
      })
      .eq("id", leadId);
    if (flagError) {
      console.error("Could not flag the lead for the owner, so no reply was sent", leadId, flagError.message);
      return true;
    }
    const { error: noteError } = await db
      .from("leads")
      .update({ handoff_note: result.note })
      .eq("id", leadId);
    if (noteError) {
      console.error("Could not save the handoff note (is migration 0005 applied?)", noteError.message);
    }
  }

  let sentId: string;
  try {
    sentId = (
      await sendWhatsAppText(business.wa_phone_number_id, lead.wa_contact_number, result.reply, business.wa_access_token)
    ).id;
  } catch (err) {
    console.error("Auto-reply send failed", leadId, err);
    await handOver("unsure", "The assistant's reply could not be sent. Please answer the customer.");
    return true;
  }

  const now = new Date().toISOString();
  const { error: msgError } = await db.from("messages").insert({
    lead_id: leadId,
    business_id: business.id,
    wa_message_id: sentId,
    direction: "out",
    body: result.reply,
    sent_at: now,
    source: "bot",
  });
  if (msgError) console.error("Could not save the assistant's message", leadId, msgError.message);

  // Once the assistant has answered, the lead is no longer "new".
  const next = { ...result.lead, stage: result.lead.stage === "new" ? ("talking" as const) : result.lead.stage };
  const merged = mergeWithLocks(lead, next);

  const { error: updateError } = await db
    .from("leads")
    .update({
      ...merged,
      last_message_at: now,
      last_outbound_at: now,
      updated_at: now,
    })
    .eq("id", leadId);
  if (updateError) console.error("Could not save the lead details", leadId, updateError.message);

  if (result.order.status !== "none") {
    // A paid order stays paid when the customer just says thanks afterwards.
    const savedStatus =
      previousOrder === "paid" && result.order.status === "confirmed" ? "paid" : result.order.status;
    const { error: orderError } = await db
      .from("leads")
      .update({
        order_status: savedStatus,
        order_summary: result.order.summary ?? orderRow?.order_summary ?? null,
      })
      .eq("id", leadId);
    if (orderError) console.error("Could not save the order (is migration 0006 applied?)", orderError.message);
  }

  return true;
}

/** The bank details from Settings. Returns null if they are not set (or migration 0006 is missing). */
async function getPaymentDetails(db: SupabaseClient, businessId: string): Promise<string | null> {
  const { data, error } = await db
    .from("businesses")
    .select("payment_details")
    .eq("id", businessId)
    .maybeSingle();
  if (error) console.error("Could not read payment details (is migration 0006 applied?)", error.message);
  const text = (data?.payment_details as string | null | undefined)?.trim();
  return text ? text : null;
}

/** Send a short message to the customer and record it in the chat. */
async function sayToCustomer(
  db: SupabaseClient,
  business: BusinessInfo,
  leadId: string,
  to: string,
  body: string,
): Promise<void> {
  const sent = await sendWhatsAppText(business.wa_phone_number_id, to, body, business.wa_access_token);
  const now = new Date().toISOString();
  await db.from("messages").insert({
    lead_id: leadId,
    business_id: business.id,
    wa_message_id: sent.id,
    direction: "out",
    body,
    sent_at: now,
    source: "bot",
  });
  await db
    .from("leads")
    .update({ last_message_at: now, last_outbound_at: now, updated_at: now })
    .eq("id", leadId);
}

/**
 * Replies that belong to the after-sale follow-ups: STOP, agreeing to follow-ups, and answers to a
 * feedback request. Returns true when the message was handled here.
 */
async function handleFollowUpReply(db: SupabaseClient, business: BusinessInfo, leadId: string): Promise<boolean> {
  const { data: fu, error } = await db
    .from("leads")
    .select("wa_contact_number, name, follow_up_consent, consent_asked_at, awaiting_feedback")
    .eq("id", leadId)
    .single();
  if (error || !fu) return false; // migration 0007 is not applied yet

  const { data: rows } = await db
    .from("messages")
    .select("direction, body, sent_at, source")
    .eq("lead_id", leadId)
    .order("sent_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(12);
  const newest = rows?.[0];
  if (!newest || newest.direction !== "in") return false;
  const text = (newest.body ?? "").trim().toLowerCase();

  // STOP always works, whether or not the assistant is on.
  if (/^(stop|berhenti|henti|unsubscribe|batal)\b/.test(text)) {
    await db.from("leads").update({ follow_up_consent: "no", awaiting_feedback: false }).eq("id", leadId);
    await db
      .from("follow_ups")
      .update({ status: "skipped", detail: "The customer opted out" })
      .eq("lead_id", leadId)
      .eq("status", "scheduled");
    await sayToCustomer(db, business, leadId, fu.wa_contact_number, "Baik, kami tak akan hantar mesej lagi. Terima kasih!");
    return true;
  }

  if (!business.auto_reply) return false;

  // "YA" to the offer that came with the payment confirmation.
  const askedRecently =
    !!fu.consent_asked_at && Date.now() - new Date(fu.consent_asked_at).getTime() < 3 * 86_400_000;
  if (fu.follow_up_consent === "unknown" && askedRecently && /^(ya|yes|y|setuju|boleh|ok|okay)[.! ]*$/.test(text)) {
    await db.from("leads").update({ follow_up_consent: "yes" }).eq("id", leadId);
    await sayToCustomer(db, business, leadId, fu.wa_contact_number, "Terima kasih! Kami akan hantar reminder dan tawaran dari semasa ke semasa. Balas STOP bila-bila masa untuk berhenti.");
    return true;
  }

  // An answer to "how was your order?".
  if (fu.awaiting_feedback) {
    const { data: biz } = await db
      .from("businesses")
      .select("follow_up_settings, tone_notes")
      .eq("id", business.id)
      .single();
    const settings = readSettings(biz?.follow_up_settings);

    const messages: ChatMessage[] = [...(rows ?? [])]
      .reverse()
      .map((r) => ({ direction: r.direction, body: r.body ?? "", sentAt: r.sent_at, source: r.source }));

    // They have moved on either way, so stop waiting for feedback.
    await db.from("leads").update({ awaiting_feedback: false }).eq("id", leadId);

    const result = await runFeedbackAgent({ messages, customerName: fu.name, toneNotes: biz?.tone_notes });
    if (!result.isFeedback) return false; // for example a new order: the normal assistant takes it

    const { error: fbError } = await db.from("feedback").insert({
      business_id: business.id,
      lead_id: leadId,
      rating: result.rating,
      comment: result.comment,
    });
    if (fbError) console.error("Could not save feedback (is migration 0007 applied?)", fbError.message);

    const unhappy = result.rating !== null ? result.rating <= 3 : result.unhappy;
    let reply = result.reply || (unhappy ? "Maaf ya. Owner akan hubungi awak." : "Terima kasih banyak!");
    if (!unhappy && settings.reviewLink) {
      reply += `\n\nKalau sudi, boleh tinggalkan review di sini: ${settings.reviewLink}`;
    }

    if (unhappy) {
      await db
        .from("leads")
        .update({
          pending_decision: true,
          human_reason: "feedback",
          handoff_note: `Rated ${result.rating ?? "?"}/5${result.comment ? `: ${result.comment}` : ""}. Please reach out.`,
        })
        .eq("id", leadId);
    }
    await sayToCustomer(db, business, leadId, fu.wa_contact_number, reply);
    return true;
  }

  return false;
}

/** Decide what to do with a lead after new messages arrived. */
async function handleLead(db: SupabaseClient, business: BusinessInfo, leadId: string): Promise<void> {
  if (await handleFollowUpReply(db, business, leadId)) return;

  const { data: lead } = await db
    .from("leads")
    .select("pending_decision, bot_paused_until")
    .eq("id", leadId)
    .single();

  const paused = !!lead?.bot_paused_until && new Date(lead.bot_paused_until) > new Date();
  const canAutoReply = business.auto_reply && !!lead && !lead.pending_decision && !paused;

  if (canAutoReply && (await autoReply(db, business, leadId))) return;
  await refreshLead(db, leadId);
}

/** Process a verified webhook payload. */
export async function processPayload(db: SupabaseClient, payload: WaWebhookPayload): Promise<void> {
  const touched = new Map<string, BusinessInfo>();

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      const phoneNumberId = value.metadata?.phone_number_id;
      if (!phoneNumberId) continue;

      const { data: business } = await db
        .from("businesses")
        .select("id, wa_phone_number_id, auto_reply, business_facts, tone_notes, wa_access_token")
        .eq("wa_phone_number_id", phoneNumberId)
        .maybeSingle();
      if (!business) {
        console.warn(`No business registered for phone_number_id ${phoneNumberId}`);
        continue;
      }

      if (change.field === "messages") {
        for (const m of value.messages ?? []) {
          const name = value.contacts?.find((c) => c.wa_id === m.from)?.profile?.name;
          const leadId = await recordMessage(db, {
            businessId: business.id,
            contactNumber: m.from,
            contactName: name,
            direction: "in",
            waMessageId: m.id,
            body: bodyOf(m),
            sentAt: new Date(Number(m.timestamp) * 1000),
            source: "customer",
          });
          if (leadId) touched.set(leadId, business as BusinessInfo);
        }
      }

      if (change.field === "smb_message_echoes") {
        for (const e of value.message_echoes ?? []) {
          const leadId = await recordMessage(db, {
            businessId: business.id,
            contactNumber: e.to,
            direction: "out",
            waMessageId: e.id,
            body: bodyOf(e),
            sentAt: new Date(Number(e.timestamp) * 1000),
            source: "owner",
          });
          if (leadId) touched.set(leadId, business as BusinessInfo);
        }
      }
    }
  }

  for (const [leadId, business] of touched) {
    try {
      await handleLead(db, business, leadId);
    } catch (err) {
      console.error("Lead handling failed", leadId, err);
    }
  }
}
