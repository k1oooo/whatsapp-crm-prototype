"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { CONSENT_ASK, readSettings } from "@/lib/follow-up-settings";
import { scheduleAfterPayment } from "@/lib/follow-ups";
import { resolveToken, sendMode, sendWhatsAppText } from "@/lib/send";
import { checkPhoneNumberAccess } from "@/lib/whatsapp-connection";
import {
  draftFollowUp,
  writeConfirmation,
  type ChatMessage,
  type LeadFields,
} from "@/lib/ai";
import { LEAD_COLUMNS, STAGES, type Lead, type Stage } from "@/lib/leads";
import type { Msg } from "@/components/chat/chat-thread";

// Row level security makes sure each of these only touches the signed-in owner's data.

export interface FormState {
  ok?: boolean;
  error?: string;
  notice?: string;
}

/** Moving a lead to Won or Lost locks the stage so the AI does not reopen it. */
export async function moveStage(leadId: string, stage: Stage): Promise<FormState> {
  if (!STAGES.includes(stage)) return { error: "Unknown stage." };
  const supabase = await createClient();

  const { data: lead } = await supabase
    .from("leads")
    .select("locked_fields")
    .eq("id", leadId)
    .single();
  const others = ((lead?.locked_fields as string[] | undefined) ?? []).filter(
    (f) => f !== "stage",
  );
  const locked =
    stage === "won" || stage === "lost" ? [...others, "stage"] : others;

  const { error } = await supabase
    .from("leads")
    .update({
      stage,
      locked_fields: locked,
      updated_at: new Date().toISOString(),
    })
    .eq("id", leadId);
  if (error) {
    console.error("moveStage failed", error.code, error.message);
    return { error: "Could not change the stage. Try again." };
  }
  revalidatePath("/dashboard", "layout");
  return { ok: true };
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

const EDITABLE = [
  "name",
  "need",
  "budget_myr",
  "quoted_price_myr",
  "deadline",
] as const;

/** Save corrections from the lead page. Changed fields are locked against AI overwrites. */
export async function updateLead(
  leadId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
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
    .update({
      ...next,
      locked_fields: [...locked],
      updated_at: new Date().toISOString(),
    })
    .eq("id", leadId);
  if (error) return { error: "Could not save. Try again." };

  // The "OK to send follow-ups" switch.
  const agreed = formData.get("follow_up_consent") === "on";
  if (agreed !== (lead.follow_up_consent === "yes")) {
    const { error: consentError } = await supabase
      .from("leads")
      .update({ follow_up_consent: agreed ? "yes" : "no" })
      .eq("id", leadId);
    if (consentError)
      return { error: "Saved, but could not change the follow-up setting." };
  }

  revalidatePath("/dashboard", "layout");
  return { ok: true };
}

/** Save the WhatsApp phone number this business sends and receives from. */
export async function saveWhatsAppConnection(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  void _prev;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Please sign in again." };

  const phoneNumberId = String(formData.get("wa_phone_number_id") ?? "").trim();
  const ownerNumber = String(formData.get("wa_owner_number") ?? "").trim();
  if (!phoneNumberId)
    return { error: "Add the phone number ID from Meta's WhatsApp Manager." };

  const update: Record<string, string | null> = {
    wa_phone_number_id: phoneNumberId,
    wa_owner_number: ownerNumber || null,
  };

  // Secret fields are write-only in the UI (never pre-filled with the real value), so a blank
  // box means "leave it as it is", not "clear it" — only an explicit checkbox does that.
  const own = (key: string) => {
    if (formData.get(`clear_${key}`) === "on") return null;
    const v = String(formData.get(key) ?? "").trim();
    return v || undefined;
  };
  const appSecret = own("wa_app_secret");
  const accessToken = own("wa_access_token");
  const verifyToken = own("wa_verify_token");
  if (appSecret !== undefined) update.wa_app_secret = appSecret;
  if (accessToken !== undefined) update.wa_access_token = accessToken;
  if (verifyToken !== undefined) update.wa_verify_token = verifyToken;

  const { data: existing } = await supabase
    .from("businesses")
    .select("wa_phone_number_id, wa_app_secret, wa_access_token, wa_verify_token")
    .eq("owner_id", user.id)
    .maybeSingle();

  // What the business will have saved once this form is applied.
  const after = (key: "wa_app_secret" | "wa_access_token" | "wa_verify_token") =>
    (key in update ? update[key] : (existing?.[key] as string | null | undefined)) ?? null;
  const effectiveToken = after("wa_access_token");

  // A business with its own Meta credentials is verified only against its own app secret. Without
  // it nobody could prove a message really came from Meta, so refuse to save that half-set-up state.
  if ((effectiveToken || after("wa_verify_token")) && !after("wa_app_secret")) {
    return {
      error:
        "Add your Meta app secret too. Without it, messages for this number cannot be verified as coming from WhatsApp.",
    };
  }

  // Prove the owner can really use this number. Skipped in test mode, where there is no live token.
  const tokenToCheck = resolveToken(effectiveToken);
  const changed = phoneNumberId !== existing?.wa_phone_number_id || accessToken !== undefined;
  if (changed && tokenToCheck && sendMode(effectiveToken) === "live") {
    const check = await checkPhoneNumberAccess(phoneNumberId, tokenToCheck);
    if (!check.ok) return { error: check.error };
  }

  const { error } = await supabase
    .from("businesses")
    .update(update)
    .eq("owner_id", user.id);

  if (error) {
    // The phone number ID and verify token must each be unique across businesses.
    if (error.code === "23505" && error.message.includes("wa_verify_token")) {
      return {
        error:
          "That verify token is already used by another business. Pick a different one.",
      };
    }
    if (error.code === "23505") {
      return {
        error: "That phone number is already connected to another business.",
      };
    }
    return { error: "Could not save. Try again." };
  }

  revalidatePath("/dashboard", "layout");
  return { ok: true };
}

/**
 * Turn a Postgres/PostgREST error into something an owner (or whoever is setting this up) can act
 * on. A missing column or table almost always means a migration was skipped, so say that plainly
 * instead of a generic "try again" that never gets better.
 */
function dbErrorMessage(
  prefix: string,
  error: { code?: string; message: string },
): string {
  if (
    error.code === "42703" ||
    error.code === "PGRST204" ||
    error.code === "42P01" ||
    error.code === "PGRST205"
  ) {
    return `${prefix}: the database is missing something this version needs (${error.message}). Run the latest supabase/migrations files in order.`;
  }
  return `${prefix}: ${error.message}`;
}

/** Save the auto-reply switch and the facts the assistant may use. */
export async function saveSettings(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
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

  // business_facts (the knowledge base's "Other notes") is saved from the Knowledge base page,
  // not here, so this never overwrites it with an empty value.
  const replyMode =
    formData.get("reply_mode") === "approve" ? "approve" : "auto";
  const { error } = await supabase
    .from("businesses")
    .update({
      auto_reply: formData.get("auto_reply") === "on",
      reply_mode: replyMode,
      tone_notes: text("tone_notes"),
      payment_details: text("payment_details"),
    })
    .eq("owner_id", user.id);
  if (error) {
    console.error("saveSettings failed", error.code, error.message);
    return { error: `Could not save: ${error.message}` };
  }
  revalidatePath("/dashboard", "layout");
  return { ok: true };
}

type Db = Awaited<ReturnType<typeof createClient>>;

interface Context {
  lead: Lead & { business_id: string };
  business: {
    wa_phone_number_id: string;
    tone_notes: string | null;
    wa_access_token: string | null;
  };
  messages: ChatMessage[];
}

/** Load a lead with its business and recent chat. Returns an error message if something is missing. */
async function loadContext(
  supabase: Db,
  leadId: string,
): Promise<Context | string> {
  const { data: leadRow } = await supabase
    .from("leads")
    .select(`${LEAD_COLUMNS}, business_id`)
    .eq("id", leadId)
    .single();
  if (!leadRow) return "Could not find this lead.";
  const lead = leadRow as unknown as Lead & { business_id: string };

  const { data: business } = await supabase
    .from("businesses")
    .select("wa_phone_number_id, tone_notes, wa_access_token")
    .eq("id", lead.business_id)
    .single();
  if (!business?.wa_phone_number_id)
    return "Could not find the WhatsApp number to send from.";

  const { data: rows } = await supabase
    .from("messages")
    .select("direction, body, sent_at, source")
    .eq("lead_id", leadId)
    .order("sent_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(30);
  const messages: ChatMessage[] = [...(rows ?? [])].reverse().map((r) => ({
    direction: r.direction,
    body: r.body ?? "",
    sentAt: r.sent_at,
    source: r.source,
  }));

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
    sent = await sendWhatsAppText(
      ctx.business.wa_phone_number_id,
      ctx.lead.wa_contact_number,
      body,
      ctx.business.wa_access_token,
    );
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
    notice: sent.dry
      ? "Test mode: saved in the conversation, not delivered to WhatsApp."
      : undefined,
  };
}

/** One click: the owner has received the payment. The assistant confirms the order to the customer. */
export async function confirmPayment(
  leadId: string,
  _prev: FormState,
  _formData: FormData,
): Promise<FormState> {
  void _prev;
  void _formData;
  const supabase = await createClient();

  const ctx = await loadContext(supabase, leadId);
  if (typeof ctx === "string") return { error: ctx };
  // Cheap early exit for the common case. The conditional update below is what actually guards the race.
  if (ctx.lead.order_status === "paid") return { error: "This order is already marked as paid." };

  // After-sale follow-up settings. Missing columns (migration 0007) just mean follow-ups are off.
  const { data: biz } = await supabase
    .from("businesses")
    .select("follow_up_settings")
    .eq("id", ctx.lead.business_id)
    .maybeSingle();
  const settings = readSettings(biz?.follow_up_settings);
  const followUpsOn = settings.feedback.enabled || settings.reorder.enabled;
  const askConsent = followUpsOn && ctx.lead.follow_up_consent === "unknown";

  let body = await writeConfirmation({
    summary: ctx.lead.order_summary,
    lead: leadFields(ctx.lead),
    messages: ctx.messages,
    toneNotes: ctx.business.tone_notes,
  });
  if (askConsent) body += `\n\n${CONSENT_ASK}`;

  // Claim the order BEFORE messaging the customer. Two clicks (a double tap, two open tabs) both read
  // "not paid yet" above, so the claim is one conditional update that only one of them can win.
  const paidAt = new Date().toISOString();
  const previousStatus = ctx.lead.order_status ?? null;
  const { data: claimed, error: claimError } = await supabase
    .from("leads")
    .update({ order_status: "paid" })
    .eq("id", leadId)
    .or("order_status.is.null,order_status.neq.paid")
    .select("id")
    .maybeSingle();
  if (claimError) {
    console.error("Could not mark the order as paid (is migration 0006 applied?)", claimError.message);
    return { error: "Could not mark the order as paid. Try again." };
  }
  if (!claimed) return { error: "This order is already marked as paid." };

  // The order is paid: mark it won, and lock the stage so the AI does not reopen it.
  const locked = [...new Set([...(ctx.lead.locked_fields ?? []), "stage"])];
  const result = await deliver(supabase, ctx, body, "bot", {
    stage: "won",
    locked_fields: locked,
  });

  if (!result.ok) {
    // The customer was not told, so the order is not paid yet. Give the click back.
    const { error } = await supabase
      .from("leads")
      .update({ order_status: previousStatus })
      .eq("id", leadId)
      .eq("order_status", "paid");
    if (error) console.error("Could not undo the paid status after a failed send", leadId, error.message);
    return result;
  }

  // Record when it was paid and queue the after-sale follow-ups for this order.
  const { error: paidError } = await supabase
    .from("leads")
    .update({
      paid_at: paidAt,
      ...(askConsent ? { consent_asked_at: paidAt } : {}),
    })
    .eq("id", leadId);
  if (paidError) {
    console.error(
      "Could not record the payment time (is migration 0007 applied?)",
      paidError.message,
    );
  } else if (followUpsOn) {
    await scheduleAfterPayment(supabase, {
      businessId: ctx.lead.business_id,
      leadId,
      deadline: ctx.lead.deadline,
      paidAt,
      settings,
    });
  }
  return result;
}

/** The owner types a decision. The assistant words it in the customer's language and sends it. */
export async function answerHandoff(
  leadId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  void _prev;
  const note = String(formData.get("note") ?? "").trim();
  if (!note)
    return {
      error: "Type your answer first, so the assistant knows what to say.",
    };

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
    return {
      error:
        "Could not write the message. The AI may be busy or out of free requests. Try again in a minute.",
    };
  }
  if (!body) return { error: "The AI returned an empty message. Try again." };

  return deliver(supabase, ctx, body, "dashboard");
}

/** Chats whose messages contain the search text. Row level security limits this to the owner's own chats. */
export async function searchMessages(query: string): Promise<string[]> {
  const q = query.trim().slice(0, 80);
  if (q.length < 2) return [];
  const supabase = await createClient();
  const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const { data, error } = await supabase
    .from("messages")
    .select("lead_id")
    .ilike("body", like)
    .limit(300);
  if (error) {
    console.error("searchMessages failed", error.code, error.message);
    return [];
  }
  return [...new Set((data ?? []).map((r) => r.lead_id as string))];
}

/** Older messages for a chat, for the "Load earlier messages" button. Oldest first. */
export async function loadEarlierMessages(
  leadId: string,
  before: string,
): Promise<{ messages: Msg[]; hasMore: boolean; error?: string }> {
  const PAGE = 100;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("messages")
    .select("id, direction, body, sent_at, source")
    .eq("lead_id", leadId)
    .lte("sent_at", before)
    .order("sent_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(PAGE + 1);
  if (error) {
    console.error("loadEarlierMessages failed", error.code, error.message);
    return { messages: [], hasMore: false, error: "Could not load earlier messages." };
  }
  const rows = data ?? [];
  return {
    messages: rows.slice(0, PAGE).reverse() as Msg[],
    hasMore: rows.length > PAGE,
  };
}

/** The owner writes a reply of their own. It goes to the customer exactly as typed. */
export async function sendOwnerMessage(
  leadId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  void _prev;
  const body = String(formData.get("body") ?? "").trim();
  if (!body) return { error: "Type a message first." };
  if (body.length > 4000)
    return { error: "That message is too long for WhatsApp. Shorten it." };

  const supabase = await createClient();
  const ctx = await loadContext(supabase, leadId);
  if (typeof ctx === "string") return { error: ctx };

  return deliver(supabase, ctx, body, "dashboard");
}

/** The assistant switch: turn the assistant on or off. */
export async function toggleAutoReply(next: boolean): Promise<FormState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Please sign in again." };

  const { error } = await supabase
    .from("businesses")
    .update({ auto_reply: next })
    .eq("owner_id", user.id);
  if (error) {
    console.error("toggleAutoReply failed", error.code, error.message);
    return { error: `Could not change the assistant: ${error.message}` };
  }

  revalidatePath("/dashboard", "layout");
  return { ok: true };
}

/**
 * Put a claimed draft back after the send failed, so the owner can try again. The owner is
 * deliberately not allowed to insert drafts (only the assistant writes them), so this uses the
 * server-only admin client. A unique violation means the assistant wrote a newer draft in the
 * meantime: that one wins and this one is dropped.
 */
async function restoreDraft(draft: {
  lead_id: string;
  business_id: string;
  body: string;
  order_status: string | null;
  order_summary: string | null;
}) {
  const { error } = await createAdminClient().from("draft_replies").insert(draft);
  if (error && error.code !== "23505") {
    console.error("Could not put the draft back after a failed send", draft.lead_id, error.message);
  }
}

/** Send a draft the assistant wrote, exactly as written or edited first. Then clear the draft. */
export async function sendDraftReply(
  leadId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  void _prev;
  const supabase = await createClient();

  const ctx = await loadContext(supabase, leadId);
  if (typeof ctx === "string") return { error: ctx };

  // Claim the draft by deleting it and reading back what was deleted. Only one request can get the
  // row, so a double click sends once. (The old order, send first and delete after, let both through.)
  const { data: draft } = await supabase
    .from("draft_replies")
    .delete()
    .eq("lead_id", leadId)
    .select("lead_id, business_id, body, order_status, order_summary")
    .maybeSingle();
  if (!draft)
    return {
      error:
        "This draft is no longer there — it may already have been sent or discarded.",
    };

  const edited = String(formData.get("body") ?? "").trim();
  const body = edited || draft.body;
  if (!body) {
    await restoreDraft(draft);
    return { error: "The draft is empty. Type a reply first." };
  }

  // A paid order stays paid even if this draft was written before the owner marked it paid.
  const extra: Record<string, unknown> = {};
  if (draft.order_status) {
    extra.order_status =
      ctx.lead.order_status === "paid" && draft.order_status === "confirmed"
        ? "paid"
        : draft.order_status;
    extra.order_summary = draft.order_summary ?? ctx.lead.order_summary ?? null;
  }

  const result = await deliver(supabase, ctx, body, "bot", extra);
  // Not delivered: put it back (with the owner's edit) so nothing they wrote is lost.
  if (!result.ok) await restoreDraft({ ...draft, body });
  return result;
}

/** The owner decides not to send this draft. The customer's messages are still there to answer by hand. */
export async function discardDraftReply(leadId: string): Promise<FormState> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("draft_replies")
    .delete()
    .eq("lead_id", leadId);
  if (error) return { error: "Could not discard the draft. Try again." };

  revalidatePath("/dashboard", "layout");
  return { ok: true };
}
