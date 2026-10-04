// The assistant: answers the customer's latest message, or hands the chat to the owner.
import type { SupabaseClient } from "@supabase/supabase-js";
import { HOLDING_FALLBACK, extractOrderLines, findPlaceholder, hasPlaceholder, runAgent, usesUnknownAmount, type AgentResult, type OrderStatus, type ChatMessage, type LeadFields } from "@/lib/ai";
import { getBusinessKnowledge } from "@/lib/knowledge";
import { log } from "@/lib/log";
import { computeOrder, computedAmounts, fillTotal, hasUnverifiedAmount, parseStoredLines, stripItemCodes, type OrderLine } from "@/lib/order";
import { sendWhatsAppText } from "@/lib/send";
import { type BusinessInfo } from "@/lib/whatsapp/types";
import { mergeWithLocks } from "@/lib/whatsapp/lead";
import { getPaymentDetails } from "@/lib/whatsapp/messaging";

/**
 * Answer the customer's latest message automatically, or hand the chat to the owner.
 * Returns false when there is nothing waiting for an answer.
 */
export async function autoReply(db: SupabaseClient, business: BusinessInfo, leadId: string): Promise<boolean> {
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

  // In "AI drafts, I approve every send" mode, a confirmed order_status is never written to the
  // lead until the owner actually sends it (see the draft-write block below) — the customer
  // hasn't seen it yet, so it isn't true until then. But if the customer sends another message
  // before the owner approves that draft, the assistant still needs to know it already asked
  // this customer to confirm, or it will start the order over from scratch on every regeneration.
  // The still-pending draft, not the lead, is the real "what have we told this customer so far".
  let effectiveOrderStatus = orderRow?.order_status ?? null;
  let effectiveOrderSummary = orderRow?.order_summary ?? null;
  if (business.reply_mode === "approve") {
    const { data: pendingDraft } = await db
      .from("draft_replies")
      .select("order_status, order_summary")
      .eq("lead_id", leadId)
      .maybeSingle();
    if (pendingDraft) {
      effectiveOrderStatus = pendingDraft.order_status ?? effectiveOrderStatus;
      effectiveOrderSummary = pendingDraft.order_summary ?? effectiveOrderSummary;
    }
  }

  const { data: rows } = await db
    .from("messages")
    .select("direction, body, sent_at, created_at, source")
    .eq("lead_id", leadId)
    // created_at first, for the same reason as refreshLead above: it keeps "newest" meaning
    // what was actually most recent, instead of whichever row has the highest-resolution
    // sent_at.
    .order("created_at", { ascending: false })
    .order("sent_at", { ascending: false })
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
  const knowledge = isMedia ? { facts: "", catalog: [] } : await getBusinessKnowledge(db, business.id);
  const facts = knowledge.facts;
  const catalog = knowledge.catalog;
  const priced = catalog.length > 0;

  // The order lines and total saved so far. Read apart from the status above, so a database that has
  // not had migration 0015 yet keeps working (with no priced orders).
  let storedLines: OrderLine[] = [];
  let storedTotal: number | null = null;
  if (priced) {
    const pending =
      business.reply_mode === "approve"
        ? await db.from("draft_replies").select("order_lines, order_total_myr").eq("lead_id", leadId).maybeSingle()
        : null;
    const fromLead = await db.from("leads").select("order_lines, order_total_myr").eq("id", leadId).maybeSingle();
    const src = pending?.data?.order_lines ? pending.data : fromLead.data;
    storedLines = parseStoredLines(src?.order_lines);
    storedTotal = storedLines.length && src?.order_total_myr != null ? Number(src.order_total_myr) : null;
  }

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
          status: (effectiveOrderStatus as OrderStatus | null) ?? "none",
          summary: effectiveOrderSummary,
        },
        messages,
        catalog,
        haveSavedLines: storedLines.length > 0 && storedTotal != null,
      });
    } catch (err) {
      // Better to stay silent and tell the owner than to send a broken message.
      console.error("Auto-reply AI failed", leadId, err);
      await handOver("unsure", "The assistant could not answer (the AI was unavailable). Please reply.");
      return true;
    }
  }

  // Order lines and total. When the business has priced menu items the SERVER prices the order from
  // the AI's item codes and quantities. The AI never adds prices, so a wrong total can not reach the
  // customer or the revenue figures.
  const handBack = (note: string) => {
    result = {
      ...result,
      action: "escalate",
      reason: "unsure",
      reply: HOLDING_FALLBACK,
      order: { status: "none", summary: null },
      note,
    };
  };
  let orderLines: OrderLine[] | null = null;
  let orderTotal: number | null = null;
  if (result.action === "reply" && priced) {
    const needsTotal = result.order.status === "awaiting_confirmation" || result.order.status === "confirmed";
    const haveStored = storedLines.length > 0 && storedTotal != null;
    const aiSent = result.order.lines ?? [];
    let computed = aiSent.length > 0 ? computeOrder(aiSent, catalog) : null;

    // The agent summarised an order but sent no usable lines (models forget the extra field now and
    // then), or sent lines that are not on the menu. Ask once, narrowly, before bothering the owner.
    // When it sent none and the order has not changed (a thank-you, an "ok"), the stored lines stand.
    const unusable = computed ? !computed.ok : !haveStored && needsTotal;
    if (unusable) {
      try {
        const again = await extractOrderLines(messages, catalog);
        computed = again.length > 0 ? computeOrder(again, catalog) : null;
        log.info(computed?.ok ? "order.lines_repaired" : "order.lines_missing", {
          leadId,
          status: result.order.status,
          agentSentLines: aiSent.length,
          repairedLines: again.length,
        });
      } catch (err) {
        computed = null;
        log.warn("order.lines_repair_failed", { leadId }, err);
      }
    }

    if (computed?.ok) {
      orderLines = computed.lines;
      orderTotal = computed.totalMyr;
    } else if (aiSent.length > 0 || computed) {
      // It gave lines we could not use and the second question did not fix them. Never fall back to the
      // stored lines here: the customer may have changed the order, and the old total would be wrong.
      handBack("The assistant could not work out this order's total from your menu. Please check the chat.");
    } else if (haveStored) {
      // A thank-you after confirming, or a customer saying "ok": the order has not changed.
      orderLines = storedLines;
      orderTotal = storedTotal;
    } else if (needsTotal) {
      handBack("The assistant summarised an order but could not work out its total from your menu. Please check the chat.");
    }
  }
  if (result.action === "reply") {
    const filled = fillTotal(result.reply, orderTotal);
    if (!filled.ok) handBack("The assistant's reply needed an order total it did not have. Please check the chat.");
    else {
      result = { ...result, reply: filled.reply };
      if (result.order.summary) result.order = { ...result.order, summary: fillTotal(result.order.summary, orderTotal).reply };
    }
  }
  // The menu text the model reads shows item codes. They are never for the customer, or the owner's summary.
  if (result.action === "reply" && priced) {
    result = {
      ...result,
      reply: stripItemCodes(result.reply),
      order: { ...result.order, summary: result.order.summary ? stripItemCodes(result.order.summary) : result.order.summary },
    };
  }

  // Safety net: no invented prices, and no empty replies.
  const chatText = messages.map((m) => m.body).join("\n");
  const unverifiedPrice = (reply: string) =>
    priced
      ? hasUnverifiedAmount(reply, facts, chatText, orderLines ? computedAmounts(orderLines, orderTotal) : [])
      : usesUnknownAmount(reply, `${facts}\n${chatText}`);
  const placeholder = result.action === "reply" ? findPlaceholder(result.reply) : null;
  if (placeholder) {
    result = {
      ...result,
      action: "escalate",
      reason: "unsure",
      reply: HOLDING_FALLBACK,
      order: { status: "none", summary: null },
      note: `The assistant's reply contained "${placeholder}", which looks like text that was never filled in. Look for text in [square brackets] in AI Settings and the Knowledge base, fix it, then answer this customer.`,
    };
  } else if (result.action === "reply" && (!result.reply || unverifiedPrice(result.reply))) {
    result = {
      ...result,
      action: "escalate",
      reason: "unsure",
      reply: HOLDING_FALLBACK,
      order: { status: "none", summary: null },
      note: "The assistant's reply had a price it could not verify. Please check the chat.",
    };
  }
  if (result.action !== "reply") {
    orderLines = null;
    orderTotal = null;
  }
  if (!result.reply) result.reply = HOLDING_FALLBACK;

  // The customer confirmed the order. The system, not the AI, adds the bank details,
  // so the account number is always copied exactly.
  const previousOrder = effectiveOrderStatus;
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
  // Compare against created_at, not sent_at: WhatsApp's inbound timestamp is whole seconds,
  // but our own outbound sent_at has millisecond precision, so a bot reply and the customer's
  // next message landing in the same second could otherwise make an earlier reply look "newer"
  // than the message we're about to answer, and this reply would be dropped silently.
  const { data: newer } = await db
    .from("messages")
    .select("id")
    .eq("lead_id", leadId)
    .eq("direction", "out")
    .gt("created_at", newest.created_at)
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

    // "AI drafts, I approve every send" means nothing goes to the customer without a click —
    // not even the "let me check with the boss" holding line auto mode would otherwise send.
    // The owner already sees this lead needs them via pending_decision; there is nothing to draft.
    if (business.reply_mode === "approve") return true;
  }

  // Once the assistant has answered, the lead is no longer "new". This is CRM data (name, need,
  // budget, stage, ...), not anything the customer sees, so it is safe to save immediately in
  // both reply modes — only the actual outbound message and the order status wait for approval.
  const next = {
    ...result.lead,
    // The quoted price is the computed total (rounded: this column is whole RM), not whatever the AI wrote.
    quoted_price_myr: orderTotal != null ? Math.round(orderTotal) : result.lead.quoted_price_myr,
    stage: result.lead.stage === "new" ? ("talking" as const) : result.lead.stage,
  };
  const merged = mergeWithLocks(lead, next);
  const { error: leadFieldsError } = await db
    .from("leads")
    .update({ ...merged, updated_at: nowIso })
    .eq("id", leadId);
  if (leadFieldsError) console.error("Could not save the lead details", leadId, leadFieldsError.message);

  if (result.action === "reply" && business.reply_mode === "approve") {
    // Hold the reply for the owner to send, instead of sending it now. order_status is part of
    // the draft rather than the lead until the owner approves: it describes what will be true
    // once the customer actually sees this reply, which has not happened yet.
    const { error: draftError } = await db.from("draft_replies").upsert(
      {
        lead_id: leadId,
        business_id: business.id,
        body: result.reply,
        order_status: result.order.status === "none" ? null : result.order.status,
        order_summary: result.order.summary ?? effectiveOrderSummary,
        ...(orderLines ? { order_lines: orderLines, order_total_myr: orderTotal } : {}),
      },
      { onConflict: "lead_id" },
    );
    if (draftError) {
      console.error("Could not save the draft reply (is migration 0011 applied?)", draftError.message);
      await handOver("unsure", "The assistant drafted a reply but could not save it. Please answer the customer.");
    }
    return true;
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

  const { error: updateError } = await db
    .from("leads")
    .update({
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

    // The priced lines and total, apart from the status above so a missing 0015 does not lose the status.
    if (orderLines) {
      const { error: linesError } = await db
        .from("leads")
        .update({ order_lines: orderLines, order_total_myr: orderTotal })
        .eq("id", leadId);
      if (linesError) console.error("Could not save the order total (is migration 0015 applied?)", linesError.message);
    }
  }

  return true;
}
