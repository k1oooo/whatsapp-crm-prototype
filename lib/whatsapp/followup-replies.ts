// Replies that belong to the after-sale follow-ups.
import type { SupabaseClient } from "@supabase/supabase-js";
import { runFeedbackAgent, type ChatMessage } from "@/lib/ai";
import { CONSENT_ASK, readSettings } from "@/lib/follow-up-settings";
import { isSubscriptionActive } from "@/lib/subscriptions";
import { type BusinessInfo } from "@/lib/whatsapp/types";
import { isOptOut, isConsentYes } from "@/lib/whatsapp/replies";
import { sayToCustomer } from "@/lib/whatsapp/messaging";

/**
 * Replies that belong to the after-sale follow-ups: STOP, agreeing to follow-ups, and answers to a
 * feedback request. Returns true when the message was handled here.
 */
export async function handleFollowUpReply(db: SupabaseClient, business: BusinessInfo, leadId: string): Promise<boolean> {
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
    .order("created_at", { ascending: false })
    .order("sent_at", { ascending: false })
    .limit(12);
  const newest = rows?.[0];
  if (!newest || newest.direction !== "in") return false;
  const text = (newest.body ?? "").trim();

  // STOP always works, whether or not the assistant is on.
  if (isOptOut(text)) {
    await db.from("leads").update({ follow_up_consent: "no", awaiting_feedback: false }).eq("id", leadId);
    await db
      .from("follow_ups")
      .update({ status: "skipped", detail: "The customer opted out" })
      .eq("lead_id", leadId)
      .eq("status", "scheduled");
    await sayToCustomer(db, business, leadId, fu.wa_contact_number, "Baik, kami tak akan hantar mesej lagi. Terima kasih!");
    return true;
  }

  // Everything below is the assistant talking (and, for feedback, an AI call), so it needs the
  // assistant on AND paid for. handleLead then flags the lead for billing if that is why.
  if (!business.auto_reply || !isSubscriptionActive(business.subscription)) return false;

  // "YA" to the offer that came with the payment confirmation. It only counts as consent when the
  // last thing we sent was that offer: a "ya" answering an order summary later must go to the order
  // assistant, not be swallowed here.
  const askedRecently =
    !!fu.consent_asked_at && Date.now() - new Date(fu.consent_asked_at).getTime() < 3 * 86_400_000;
  const lastOutbound = rows?.find((r) => r.direction === "out");
  const offerIsLastMessage = !!lastOutbound?.body && lastOutbound.body.includes(CONSENT_ASK);
  if (fu.follow_up_consent === "unknown" && askedRecently && offerIsLastMessage && isConsentYes(text)) {
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
