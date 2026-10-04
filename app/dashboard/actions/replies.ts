"use server";

// Messaging customers from the dashboard: payment confirmation, handoff answers, owner messages, drafts.
import { revalidatePath } from "next/cache";
import type { Json } from "@/lib/db-types";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { CONSENT_ASK, readSettings } from "@/lib/follow-up-settings";
import { scheduleAfterPayment } from "@/lib/follow-ups";
import { draftFollowUp, writeConfirmation } from "@/lib/ai";
import { type FormState, loadContext, leadFields, deliver } from "@/app/dashboard/actions/shared";

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
  order_lines?: Json | null;
  order_total_myr?: number | null;
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
  const { data: draft, error: claimError } = await supabase
    .from("draft_replies")
    .delete()
    .eq("lead_id", leadId)
    .select("lead_id, business_id, body, order_status, order_summary, order_lines, order_total_myr")
    .maybeSingle();
  if (claimError) {
    console.error("Could not claim the draft (is migration 0015 applied?)", claimError.message);
    return { error: "Could not send the draft. Try again." };
  }
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
  // The priced order the assistant worked out travels with the draft onto the lead.
  if (draft.order_lines) {
    extra.order_lines = draft.order_lines;
    extra.order_total_myr = draft.order_total_myr ?? null;
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
