// After-sale follow-ups: scheduling them when an order is paid, and sending the ones that are due.
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  readSettings,
  renderText,
  templateParams,
  type FollowUpKind,
  type FollowUpSettings,
} from "@/lib/follow-up-settings";
import { parseOrderSummary } from "@/lib/leads";
import { sendWhatsAppTemplate, sendWhatsAppText } from "@/lib/send";

const DAY = 86_400_000;
const WINDOW_MS = 23 * 60 * 60 * 1000; // stay inside WhatsApp's 24 hour window with a margin

/** 10:00 Malaysia time, `days` after the base date (YYYY-MM-DD), or after today when there is none. */
export function dueAt(baseDate: string | null, days: number): string {
  const day = baseDate ?? new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kuala_Lumpur" });
  return new Date(new Date(`${day}T10:00:00+08:00`).getTime() + days * DAY).toISOString();
}

function klHour(): number {
  return Number(
    new Date().toLocaleString("en-US", { timeZone: "Asia/Kuala_Lumpur", hour: "numeric", hour12: false }),
  ) % 24;
}

/** Queue the feedback request and the reorder reminder for a newly paid order. */
export async function scheduleAfterPayment(
  db: SupabaseClient,
  args: {
    businessId: string;
    leadId: string;
    deadline: string | null;
    paidAt: string;
    settings: FollowUpSettings;
  },
): Promise<void> {
  const { businessId, leadId, deadline, paidAt, settings } = args;
  const rows: { kind: FollowUpKind; due_at: string }[] = [];
  if (settings.feedback.enabled) rows.push({ kind: "feedback", due_at: dueAt(deadline, settings.feedback.delayDays) });
  if (settings.reorder.enabled) rows.push({ kind: "reorder", due_at: dueAt(deadline, settings.reorder.afterDays) });

  for (const row of rows) {
    const { error } = await db.from("follow_ups").insert({
      business_id: businessId,
      lead_id: leadId,
      kind: row.kind,
      order_key: paidAt,
      due_at: row.due_at,
    });
    // 23505 means this follow-up is already queued for this order. That is fine.
    if (error && error.code !== "23505") {
      console.error("Could not schedule a follow-up (is migration 0007 applied?)", error.message);
    }
  }
}

export interface RunSummary {
  sent: number;
  skipped: number;
  failed: number;
  waiting: number;
}

type Outcome = keyof RunSummary;

/**
 * Send every follow-up that is due. Called by the daily job, and by the "Run now" and "Send now"
 * buttons. The daily job stays quiet at night. A button press sends right away.
 */
export async function runDueFollowUps(
  db: SupabaseClient,
  opts: { businessId?: string; onlyId?: string; ignoreQuietHours?: boolean } = {},
): Promise<RunSummary> {
  const summary: RunSummary = { sent: 0, skipped: 0, failed: 0, waiting: 0 };

  if (!opts.ignoreQuietHours) {
    const hour = klHour();
    if (hour < 9 || hour >= 21) return summary;
  }

  let query = db
    .from("follow_ups")
    .select("id")
    .eq("status", "scheduled")
    .lte("due_at", new Date().toISOString())
    .order("due_at", { ascending: true })
    .limit(100);
  if (opts.businessId) query = query.eq("business_id", opts.businessId);
  if (opts.onlyId) query = query.eq("id", opts.onlyId);

  const { data: due, error } = await query;
  if (error) {
    console.error("Could not read follow-ups (is migration 0007 applied?)", error.message);
    return summary;
  }

  for (const row of due ?? []) {
    try {
      summary[await processOne(db, row.id)]++;
    } catch (err) {
      console.error("Follow-up failed", row.id, err);
      summary.failed++;
    }
  }
  return summary;
}

async function processOne(db: SupabaseClient, id: string): Promise<Outcome> {
  // Claim it, so two runs at the same time cannot send it twice.
  const { data: fu } = await db
    .from("follow_ups")
    .update({ status: "sending" })
    .eq("id", id)
    .eq("status", "scheduled")
    .select("id, business_id, lead_id, kind, order_key, template_name, body")
    .maybeSingle();
  if (!fu) return "waiting";

  const finish = async (status: "scheduled" | "sent" | "skipped" | "failed", detail: string | null, extra = {}) => {
    await db.from("follow_ups").update({ status, detail, ...extra }).eq("id", id);
  };

  const { data: lead } = await db
    .from("leads")
    .select(
      "id, name, need, order_summary, wa_contact_number, follow_up_consent, pending_decision, last_inbound_at, paid_at",
    )
    .eq("id", fu.lead_id)
    .single();
  const { data: business } = await db
    .from("businesses")
    .select("id, wa_phone_number_id, follow_up_settings")
    .eq("id", fu.business_id)
    .single();
  if (!lead || !business) {
    await finish("failed", "The customer or the business could not be found");
    return "failed";
  }

  if (lead.follow_up_consent === "no") {
    await finish("skipped", "The customer opted out");
    return "skipped";
  }
  if (lead.follow_up_consent !== "yes") {
    await finish("scheduled", "Waiting for the customer to agree to follow-ups");
    return "waiting";
  }
  if (lead.pending_decision) {
    await finish("scheduled", "This chat needs you first");
    return "waiting";
  }
  // The database and JavaScript write the same instant differently, so compare it as a time.
  if (fu.order_key && lead.paid_at && new Date(lead.paid_at).getTime() !== new Date(fu.order_key).getTime()) {
    await finish("skipped", "The customer has placed a newer order");
    return "skipped";
  }

  const settings = readSettings(business.follow_up_settings);
  const vars = {
    name: lead.name,
    items: lead.order_summary ? parseOrderSummary(lead.order_summary, lead.name).items : lead.need,
    link: settings.reviewLink || null,
  };

  let templateName: string;
  let source: string;
  if (fu.kind === "marketing") {
    source = fu.body ?? "";
    templateName = fu.template_name ?? "";
  } else {
    const cfg = fu.kind === "feedback" ? settings.feedback : settings.reorder;
    source = cfg.text;
    templateName = cfg.templateName;
  }
  const text = renderText(source, vars);
  if (!text.trim()) {
    await finish("failed", "There is no message text");
    return "failed";
  }

  const inWindow = !!lead.last_inbound_at && Date.now() - new Date(lead.last_inbound_at).getTime() < WINDOW_MS;

  let sent;
  try {
    sent = inWindow
      ? await sendWhatsAppText(business.wa_phone_number_id, lead.wa_contact_number, text)
      : await sendWhatsAppTemplate(
          business.wa_phone_number_id,
          lead.wa_contact_number,
          templateName,
          settings.language,
          templateParams(source, vars),
        );
  } catch (err) {
    await finish("failed", err instanceof Error ? err.message.slice(0, 300) : "Could not send");
    return "failed";
  }

  const now = new Date().toISOString();
  await db.from("messages").insert({
    lead_id: lead.id,
    business_id: business.id,
    wa_message_id: sent.id,
    direction: "out",
    body: text,
    sent_at: now,
    source: "bot",
  });
  await db
    .from("leads")
    .update({
      last_message_at: now,
      last_outbound_at: now,
      updated_at: now,
      ...(fu.kind === "feedback" ? { awaiting_feedback: true } : {}),
    })
    .eq("id", lead.id);

  await finish("sent", sent.dry ? "Test mode: saved in the chat, not delivered" : null, { sent_at: now, body: text });
  return "sent";
}
