// WhatsApp Cloud API helpers: signature check, payload types, and message ingestion.
import crypto from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  extractLead,
  mergeLead,
  type ChatMessage,
  type LeadFields,
} from "@/lib/ai";

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

export function verifySignature(
  rawBody: string,
  header: string | null,
): boolean {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret || !header?.startsWith("sha256=")) return false;

  const expected = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");
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
  },
): Promise<string | null> {
  const {
    businessId,
    contactNumber,
    contactName,
    direction,
    waMessageId,
    body,
    sentAt,
  } = args;
  const sentIso = sentAt.toISOString();

  // Find or create the lead.
  const { data: existing } = await db
    .from("leads")
    .select("id, name, last_message_at, last_inbound_at, last_outbound_at")
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
  });
  if (msgError) {
    if (msgError.code === "23505") return null;
    throw msgError;
  }

  // Keep the timestamps at the latest value even if messages arrive out of order.
  const later = (a: string | null | undefined, b: string) =>
    !a || new Date(a) < new Date(b) ? b : a;
  const update: Record<string, string> = {
    last_message_at: later(existing?.last_message_at, sentIso),
    updated_at: new Date().toISOString(),
  };
  if (direction === "in")
    update.last_inbound_at = later(existing?.last_inbound_at, sentIso);
  else update.last_outbound_at = later(existing?.last_outbound_at, sentIso);
  if (!existing?.name && contactName) update.name = contactName;

  await db.from("leads").update(update).eq("id", leadId);
  return leadId;
}

/** Re-read the recent chat, extract lead fields, and merge them into the lead. */
export async function refreshLead(
  db: SupabaseClient,
  leadId: string,
): Promise<void> {
  const { data: lead } = await db
    .from("leads")
    .select("name, need, budget_myr, deadline, stage, language")
    .eq("id", leadId)
    .single();
  if (!lead) return;

  const { data: rows } = await db
    .from("messages")
    .select("direction, body, sent_at")
    .eq("lead_id", leadId)
    .order("sent_at", { ascending: false })
    .limit(30);

  const messages: ChatMessage[] = (rows ?? [])
    .reverse()
    .map((r) => ({
      direction: r.direction,
      body: r.body ?? "",
      sentAt: r.sent_at,
    }));

  const extracted = await extractLead(messages);
  const merged = mergeLead(lead as Partial<LeadFields>, extracted);

  await db
    .from("leads")
    .update({ ...merged, updated_at: new Date().toISOString() })
    .eq("id", leadId);
}

/** Process a verified webhook payload. */
export async function processPayload(
  db: SupabaseClient,
  payload: WaWebhookPayload,
): Promise<void> {
  const touched = new Set<string>();

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      const phoneNumberId = value.metadata?.phone_number_id;
      if (!phoneNumberId) continue;

      const { data: business } = await db
        .from("businesses")
        .select("id")
        .eq("wa_phone_number_id", phoneNumberId)
        .maybeSingle();
      if (!business) {
        console.warn(
          `No business registered for phone_number_id ${phoneNumberId}`,
        );
        continue;
      }

      if (change.field === "messages") {
        for (const m of value.messages ?? []) {
          const name = value.contacts?.find((c) => c.wa_id === m.from)?.profile
            ?.name;
          const leadId = await recordMessage(db, {
            businessId: business.id,
            contactNumber: m.from,
            contactName: name,
            direction: "in",
            waMessageId: m.id,
            body: bodyOf(m),
            sentAt: new Date(Number(m.timestamp) * 1000),
          });
          if (leadId) touched.add(leadId);
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
          });
          if (leadId) touched.add(leadId);
        }
      }
    }
  }

  for (const leadId of touched) {
    try {
      await refreshLead(db, leadId);
    } catch (err) {
      console.error("Lead extraction failed", leadId, err);
    }
  }
}
