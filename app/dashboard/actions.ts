"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { sendWhatsAppText } from "@/lib/send";
import { draftFollowUp, writeConfirmation, type ChatMessage, type LeadFields } from "@/lib/ai";
import { LEAD_COLUMNS, STAGES, type Lead, type Stage } from "@/lib/leads";

// Row level security makes sure each of these only touches the signed-in owner's data.

export interface FormState {
  ok?: boolean;
  error?: string;
  notice?: string;
}

/** Moving a lead to Won or Lost locks the stage so the AI does not reopen it. */
export async function moveStage(leadId: string, stage: Stage) {
  if (!STAGES.includes(stage)) return;
  const supabase = await createClient();

  const { data: lead } = await supabase
    .from("leads")
    .select("locked_fields")
    .eq("id", leadId)
    .single();
  const others = ((lead?.locked_fields as string[] | undefined) ?? []).filter((f) => f !== "stage");
  const locked = stage === "won" || stage === "lost" ? [...others, "stage"] : others;

  await supabase
    .from("leads")
    .update({ stage, locked_fields: locked, updated_at: new Date().toISOString() })
    .eq("id", leadId);
  revalidatePath("/dashboard", "layout");
}

/** For when you answered the customer outside the app. */
export async function clearPending(leadId: string) {
  const supabase = await createClient();
  await supabase
    .from("leads")
    .update({
      pending_decision: false,
      human_reason: null,
      handoff_note: null,
      bot_paused_until: null,
      last_chased_at: new Date().toISOString(),
    })
    .eq("id", leadId);
  revalidatePath("/dashboard", "layout");
}

const EDITABLE = ["name", "need", "budget_myr", "quoted_price_myr", "deadline"] as const;

/** Save corrections from the lead page. Changed fields are locked against AI overwrites. */
export async function updateLead(leadId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  void _prev;
  const supabase = await createClient();

  const { data: current } = await supabase
    .from("leads")
    .select(LEAD_COLUMNS)
    .eq("id", leadId)
    .single();
  if (!current) return { error: "Could not find this lead." };
  const lead = current as unknown as Lead;

  const text = (key: string) => {
    const v = String(formData.get(key) ?? "").trim();
    return v === "" ? null : v;
  };
  const whole = (key: string) => {
    const v = text(key);
    if (v === null) return null;
    const n = Math.round(Number(v));
    return Number.isFinite(n) && n >= 0 ? n : NaN;
  };

  const next = {
    name: text("name"),
    need: text("need"),
    budget_myr: whole("budget_myr"),
    quoted_price_myr: whole("quoted_price_myr"),
    deadline: text("deadline"),
  };

  if (Number.isNaN(next.budget_myr) || Number.isNaN(next.quoted_price_myr)) {
    return { error: "Amounts must be whole numbers, like 220." };
  }
  if (next.deadline && !/^\d{4}-\d{2}-\d{2}$/.test(next.deadline)) {
    return { error: "Pick the deadline from the date picker." };
  }

  const locked = new Set(lead.locked_fields ?? []);
  for (const key of EDITABLE) {
    if (next[key] !== lead[key]) locked.add(key);
  }

  const { error } = await supabase
    .from("leads")
    .update({ ...next, locked_fields: [...locked], updated_at: new Date().toISOString() })
    .eq("id", leadId);
  if (error) return { error: "Could not save. Try again." };

  revalidatePath("/dashboard", "layout");
  return { ok: true };
}

/** Save the auto-reply switch and the facts the assistant may use. */
export async function saveSettings(_prev: FormState, formData: FormData): Promise<FormState> {
  void _prev;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Please sign in again." };

  const text = (key: string) => {
    const v = String(formData.get(key) ?? "").trim();
    return v === "" ? null : v;
  };

  const { error } = await supabase
    .from("businesses")
    .update({
      auto_reply: formData.get("auto_reply") === "on",
      business_facts: text("business_facts"),
      tone_notes: text("tone_notes"),
      payment_details: text("payment_details"),
    })
    .eq("owner_id", user.id);
  if (error) return { error: "Could not save. Try again." };

  revalidatePath("/dashboard", "layout");
  return { ok: true };
}

type Db = Awaited<ReturnType<typeof createClient>>;

interface Context {
  lead: Lead & { business_id: string };
  business: { wa_phone_number_id: string; tone_notes: string | null };
  messages: ChatMessage[];
}

/** Load a lead with its business and recent chat. Returns an error message if something is missing. */
async function loadContext(supabase: Db, leadId: string): Promise<Context | string> {
  const { data: leadRow } = await supabase
    .from("leads")
    .select(`${LEAD_COLUMNS}, business_id`)
    .eq("id", leadId)
    .single();
  if (!leadRow) return "Could not find this lead.";
  const lead = leadRow as unknown as Lead & { business_id: string };

  const { data: business } = await supabase
    .from("businesses")
    .select("wa_phone_number_id, tone_notes")
    .eq("id", lead.business_id)
    .single();
  if (!business?.wa_phone_number_id) return "Could not find the WhatsApp number to send from.";

  const { data: rows } = await supabase
    .from("messages")
    .select("direction, body, sent_at, source")
    .eq("lead_id", leadId)
    .order("sent_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(30);
  const messages: ChatMessage[] = [...(rows ?? [])]
    .reverse()
    .map((r) => ({ direction: r.direction, body: r.body ?? "", sentAt: r.sent_at, source: r.source }));

  return { lead, business, messages };
}

function leadFields(lead: Lead): LeadFields {
  return {
    name: lead.name,
    need: lead.need,
    budget_myr: lead.budget_myr,
    quoted_price_myr: lead.quoted_price_myr,
    deadline: lead.deadline,
    stage: lead.stage,
    language: lead.language,
  };
}

/** Send a message, record it in the conversation, and close the handover. */
async function deliver(
  supabase: Db,
  ctx: Context,
  body: string,
  source: "bot" | "dashboard",
  extra: Record<string, unknown> = {},
): Promise<FormState> {
  let sent;
  try {
    sent = await sendWhatsAppText(ctx.business.wa_phone_number_id, ctx.lead.wa_contact_number, body);
  } catch (err) {
    console.error("Send failed", err);
    return {
      error:
        "WhatsApp did not accept the message. The customer may have last written more than 24 hours ago, or the access token may be wrong.",
    };
  }

  const now = new Date().toISOString();
  await supabase.from("messages").insert({
    lead_id: ctx.lead.id,
    business_id: ctx.lead.business_id,
    wa_message_id: sent.id,
    direction: "out",
    body,
    sent_at: now,
    source,
  });

  await supabase
    .from("leads")
    .update({
      last_message_at: now,
      last_outbound_at: now,
      last_chased_at: now,
      pending_decision: false,
      human_reason: null,
      handoff_note: null,
      bot_paused_until: null,
      updated_at: now,
      ...extra,
    })
    .eq("id", ctx.lead.id);

  revalidatePath("/dashboard", "layout");
  return {
    ok: true,
    notice: sent.dry ? "Test mode: saved in the conversation, not delivered to WhatsApp." : undefined,
  };
}

/** One click: the owner has received the payment. The assistant confirms the order to the customer. */
export async function confirmPayment(leadId: string, _prev: FormState, _formData: FormData): Promise<FormState> {
  void _prev;
  void _formData;
  const supabase = await createClient();

  const ctx = await loadContext(supabase, leadId);
  if (typeof ctx === "string") return { error: ctx };

  const body = await writeConfirmation({
    summary: ctx.lead.order_summary,
    lead: leadFields(ctx.lead),
    messages: ctx.messages,
    toneNotes: ctx.business.tone_notes,
  });

  // The order is paid: mark it won, and lock the stage so the AI does not reopen it.
  const locked = [...new Set([...(ctx.lead.locked_fields ?? []), "stage"])];
  const result = await deliver(supabase, ctx, body, "bot", { stage: "won", locked_fields: locked });

  if (result.ok) {
    const { error } = await supabase.from("leads").update({ order_status: "paid" }).eq("id", leadId);
    if (error) console.error("Could not mark the order as paid (is migration 0006 applied?)", error.message);
  }
  return result;
}

/** The owner types a decision. The assistant words it in the customer's language and sends it. */
export async function answerHandoff(leadId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  void _prev;
  const note = String(formData.get("note") ?? "").trim();
  if (!note) return { error: "Type your answer first, so the assistant knows what to say." };

  const supabase = await createClient();
  const ctx = await loadContext(supabase, leadId);
  if (typeof ctx === "string") return { error: ctx };

  let body: string;
  try {
    body = await draftFollowUp({
      lead: leadFields(ctx.lead),
      messages: ctx.messages,
      daysQuiet: 0,
      toneNotes: ctx.business.tone_notes,
      awaitingOwnerReply: true,
      ownerNote: note,
    });
  } catch (err) {
    console.error("Answer failed", err);
    return { error: "Could not write the message. The AI may be busy or out of free requests. Try again in a minute." };
  }
  if (!body) return { error: "The AI returned an empty message. Try again." };

  return deliver(supabase, ctx, body, "dashboard");
}
