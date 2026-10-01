import crypto from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { isConsentYes, isOptOut, processPayload, verifySignature } from "@/lib/whatsapp";
import { CONSENT_ASK } from "@/lib/follow-up-settings";
import { createFakeSupabase, type FakeDb } from "@/test/fake-supabase";
import { inboundMediaPayload, inboundTextPayload } from "@/test/webhook-fixtures";

const PHONE_NUMBER_ID = "TEST_PHONE_NUMBER_ID";
const CUSTOMER = "60123456789";

function makeBusiness(overrides: Record<string, unknown> = {}) {
  return {
    id: "biz-1",
    owner_id: "owner-1",
    name: "Test Bakery",
    wa_phone_number_id: PHONE_NUMBER_ID,
    auto_reply: false,
    business_facts: null,
    tone_notes: null,
    wa_access_token: null,
    payment_details: null,
    ...overrides,
  };
}

/**
 * Every business in these tests has an active paid subscription unless a test says otherwise,
 * because processPayload now refuses to run any AI for a business without one.
 */
function createDb(seed: FakeDb = {}) {
  return createFakeSupabase({
    subscriptions: [{ business_id: "biz-1", status: "active", trial_ends_at: null, current_period_end: null }],
    ...seed,
  });
}

/** Every test runs with no AI keys set, so lib/ai.ts's deterministic mock provider is used. */
beforeEach(() => {
  delete process.env.AI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.WHATSAPP_SEND_MODE;
});

describe("verifySignature", () => {
  const secret = "shh-its-a-secret";
  const body = JSON.stringify({ hello: "world" });

  it("accepts a correctly signed payload", () => {
    const header = "sha256=" + crypto.createHmac("sha256", secret).update(body).digest("hex");
    expect(verifySignature(body, header, secret)).toBe(true);
  });

  it("rejects a payload signed with the wrong secret", () => {
    const header = "sha256=" + crypto.createHmac("sha256", secret).update(body).digest("hex");
    expect(verifySignature(body, header, "a-different-secret")).toBe(false);
  });

  it("rejects a payload whose body was tampered with after signing", () => {
    const header = "sha256=" + crypto.createHmac("sha256", secret).update(body).digest("hex");
    expect(verifySignature(body + "tampered", header, secret)).toBe(false);
  });

  it("rejects a missing signature header", () => {
    expect(verifySignature(body, null, secret)).toBe(false);
  });

  it("rejects a header missing the sha256= prefix", () => {
    const raw = crypto.createHmac("sha256", secret).update(body).digest("hex");
    expect(verifySignature(body, raw, secret)).toBe(false);
  });

  it("rejects when no secret is configured for this business or the deployment", () => {
    const header = "sha256=" + crypto.createHmac("sha256", secret).update(body).digest("hex");
    expect(verifySignature(body, header, undefined)).toBe(false);
  });
});

describe("processPayload: webhook idempotency (Meta retries the same delivery)", () => {
  it("does not create a second message or a second bot reply when the same wamid arrives twice", async () => {
    const db = createDb({ businesses: [makeBusiness({ auto_reply: true })] as FakeDb["businesses"] });

    const payload = inboundTextPayload({
      phoneNumberId: PHONE_NUMBER_ID,
      from: CUSTOMER,
      body: "Hi, nak order boleh?",
      messageId: "wamid.RETRY_TEST",
    });

    await processPayload(db, payload);
    const leadsAfterFirst = db._db.leads.length;
    const messagesAfterFirst = db._db.messages.length;

    // Meta retried the same webhook delivery (network hiccup, no 200 seen in time, etc).
    await processPayload(db, payload);

    expect(db._db.leads.length).toBe(leadsAfterFirst);
    expect(db._db.messages.length).toBe(messagesAfterFirst);
    // Exactly one customer message and one bot reply, never a duplicate of either.
    expect(db._db.messages.filter((m) => m.wa_message_id === "wamid.RETRY_TEST")).toHaveLength(1);
  });

  it("still creates separate leads for two different customers", async () => {
    const db = createDb({ businesses: [makeBusiness()] as FakeDb["businesses"] });

    await processPayload(db, inboundTextPayload({ phoneNumberId: PHONE_NUMBER_ID, from: "60111111111", body: "Hi" }));
    await processPayload(db, inboundTextPayload({ phoneNumberId: PHONE_NUMBER_ID, from: "60222222222", body: "Hi" }));

    expect(db._db.leads).toHaveLength(2);
  });
});

describe("processPayload: order-status transitions", () => {
  it("walks collecting -> awaiting_confirmation -> confirmed, then stays paid after a manual mark-as-paid", async () => {
    const db = createDb({
      businesses: [
        makeBusiness({ auto_reply: true, payment_details: "Maybank 1234567890, KioWeb Enterprise" }),
      ] as FakeDb["businesses"],
    });

    // Turns are spaced several seconds apart, like a real chat (see the webhook-timestamp-race
    // regression test below for what happens when they land in the same second).
    const t = (secondsFromNow: number) => new Date(Date.now() + secondsFromNow * 1000);

    // Turn 1: customer starts an order -> "collecting".
    await processPayload(
      db,
      inboundTextPayload({
        phoneNumberId: PHONE_NUMBER_ID,
        from: CUSTOMER,
        body: "Saya nak order 12 cupcakes",
        sentAt: t(0),
      }),
    );
    let lead = db._db.leads[0];
    expect(lead.order_status).toBe("collecting");

    // Turn 2: any reply while collecting -> the assistant sends a summary, "awaiting_confirmation".
    await processPayload(
      db,
      inboundTextPayload({
        phoneNumberId: PHONE_NUMBER_ID,
        from: CUSTOMER,
        body: "Pickup esok pukul 10 pagi",
        sentAt: t(30),
      }),
    );
    lead = db._db.leads[0];
    expect(lead.order_status).toBe("awaiting_confirmation");

    // Turn 3: customer confirms -> "confirmed", and payment details are appended automatically.
    await processPayload(
      db,
      inboundTextPayload({ phoneNumberId: PHONE_NUMBER_ID, from: CUSTOMER, body: "ok", sentAt: t(60) }),
    );
    lead = db._db.leads[0];
    expect(lead.order_status).toBe("confirmed");
    const lastBotMessage = [...db._db.messages].reverse().find((m) => m.source === "bot");
    expect(String(lastBotMessage?.body)).toContain("Maybank 1234567890");

    // The owner checks the receipt and marks the order paid from the dashboard
    // (app/dashboard/actions.ts markPaid does this same write).
    lead.order_status = "paid";

    // Turn 4: customer just says thanks afterwards -> must NOT be downgraded away from "paid".
    await processPayload(
      db,
      inboundTextPayload({ phoneNumberId: PHONE_NUMBER_ID, from: CUSTOMER, body: "tq!", sentAt: t(120) }),
    );
    lead = db._db.leads[0];
    expect(lead.order_status).toBe("paid");
  });

  it("still replies when a follow-up message lands in the same wall-clock second as the previous bot reply", async () => {
    // WhatsApp's inbound timestamp is whole seconds, but our own outbound sent_at has
    // millisecond precision. A naive "did someone answer after this?" check compared those
    // two directly and could see the earlier bot reply as "newer" than the truncated
    // timestamp of the customer's very next message, silently dropping the reply.
    const db = createDb({ businesses: [makeBusiness({ auto_reply: true })] as FakeDb["businesses"] });
    const now = new Date();

    await processPayload(
      db,
      inboundTextPayload({ phoneNumberId: PHONE_NUMBER_ID, from: CUSTOMER, body: "Saya nak order", sentAt: now }),
    );
    expect(db._db.leads[0].order_status).toBe("collecting");

    // A couple of real milliseconds pass before the customer's follow-up (as they always would),
    // even though WhatsApp's whole-second timestamp reports it as the "same second" as the
    // turn above, and therefore the same second as the bot's reply to it.
    await new Promise((r) => setTimeout(r, 5));
    await processPayload(
      db,
      inboundTextPayload({ phoneNumberId: PHONE_NUMBER_ID, from: CUSTOMER, body: "esok pukul 10", sentAt: now }),
    );

    const lead = db._db.leads[0];
    expect(lead.order_status).toBe("awaiting_confirmation");
    const botReplies = db._db.messages.filter((m) => m.source === "bot");
    expect(botReplies).toHaveLength(2);
  });

  it("escalates for a discount request instead of ever agreeing to one", async () => {
    const db = createDb({ businesses: [makeBusiness({ auto_reply: true })] as FakeDb["businesses"] });

    await processPayload(
      db,
      inboundTextPayload({ phoneNumberId: PHONE_NUMBER_ID, from: CUSTOMER, body: "Boleh diskaun sikit tak?" }),
    );

    const lead = db._db.leads[0];
    expect(lead.pending_decision).toBe(true);
    expect(lead.human_reason).toBe("discount");
    expect(lead.order_status).not.toBe("confirmed");
  });

  it("does not send a payment confirmation reply when payment details are missing from Settings", async () => {
    const db = createDb({
      businesses: [makeBusiness({ auto_reply: true, payment_details: null })] as FakeDb["businesses"],
    });

    const t = (secondsFromNow: number) => new Date(Date.now() + secondsFromNow * 1000);
    await processPayload(
      db,
      inboundTextPayload({
        phoneNumberId: PHONE_NUMBER_ID,
        from: CUSTOMER,
        body: "Saya nak order 12 cupcakes",
        sentAt: t(0),
      }),
    );
    await processPayload(
      db,
      inboundTextPayload({
        phoneNumberId: PHONE_NUMBER_ID,
        from: CUSTOMER,
        body: "Pickup esok pukul 10 pagi",
        sentAt: t(30),
      }),
    );
    await processPayload(
      db,
      inboundTextPayload({ phoneNumberId: PHONE_NUMBER_ID, from: CUSTOMER, body: "ok", sentAt: t(60) }),
    );

    const lead = db._db.leads[0];
    // Hands over instead of confirming with no bank details to send.
    expect(lead.pending_decision).toBe(true);
    expect(lead.human_reason).toBe("unsure");
    expect(lead.order_status).not.toBe("confirmed");
  });
});

describe("processPayload: pending_decision / handoff logic", () => {
  it("hands over a photo (likely a payment receipt) without guessing what it is", async () => {
    const db = createDb({ businesses: [makeBusiness({ auto_reply: true })] as FakeDb["businesses"] });

    await processPayload(
      db,
      inboundMediaPayload({ phoneNumberId: PHONE_NUMBER_ID, from: CUSTOMER, mediaType: "image" }),
    );

    const lead = db._db.leads[0];
    expect(lead.pending_decision).toBe(true);
    expect(lead.human_reason).toBe("payment");
    expect(String(lead.handoff_note)).toMatch(/photo|file/i);
  });

  it("hands over a voice note as 'unsure', not 'payment'", async () => {
    const db = createDb({ businesses: [makeBusiness({ auto_reply: true })] as FakeDb["businesses"] });

    await processPayload(
      db,
      inboundMediaPayload({ phoneNumberId: PHONE_NUMBER_ID, from: CUSTOMER, mediaType: "audio" }),
    );

    const lead = db._db.leads[0];
    expect(lead.pending_decision).toBe(true);
    expect(lead.human_reason).toBe("unsure");
  });

  it("does not auto-reply at all when auto_reply is off for the business", async () => {
    const db = createDb({ businesses: [makeBusiness({ auto_reply: false })] as FakeDb["businesses"] });

    await processPayload(
      db,
      inboundTextPayload({ phoneNumberId: PHONE_NUMBER_ID, from: CUSTOMER, body: "Hi, nak order boleh?" }),
    );

    // Only the inbound customer message exists; nothing was sent back.
    expect(db._db.messages).toHaveLength(1);
    expect(db._db.messages[0].direction).toBe("in");
  });

  it("honours STOP immediately, even when auto_reply is off", async () => {
    const db = createDb({ businesses: [makeBusiness({ auto_reply: false })] as FakeDb["businesses"] });

    // Seed an existing lead so handleFollowUpReply's lookup has migration-0007 columns to read.
    db._db.leads = [
      {
        id: "lead-1",
        business_id: "biz-1",
        wa_contact_number: CUSTOMER,
        name: "Test Customer",
        follow_up_consent: "unknown",
        consent_asked_at: null,
        awaiting_feedback: false,
        pending_decision: false,
        locked_fields: [],
        stage: "won",
      },
    ];

    await processPayload(db, inboundTextPayload({ phoneNumberId: PHONE_NUMBER_ID, from: CUSTOMER, body: "STOP" }));

    const lead = db._db.leads.find((l) => l.wa_contact_number === CUSTOMER);
    expect(lead?.follow_up_consent).toBe("no");
    const reply = db._db.messages.find((m) => m.source === "bot");
    expect(reply).toBeTruthy();
  });
});

describe("processPayload: reply_mode 'approve' (AI drafts, owner sends)", () => {
  it("drafts a reply instead of sending it, but still updates CRM fields immediately", async () => {
    const db = createDb({
      businesses: [makeBusiness({ auto_reply: true, reply_mode: "approve" })] as FakeDb["businesses"],
    });

    await processPayload(
      db,
      inboundTextPayload({ phoneNumberId: PHONE_NUMBER_ID, from: CUSTOMER, body: "Saya nak order 12 cupcakes" }),
    );

    // Nothing was sent: only the customer's own inbound message exists.
    expect(db._db.messages).toHaveLength(1);
    expect(db._db.messages[0].direction).toBe("in");

    // But a draft was written for the owner to review.
    expect(db._db.draft_replies).toHaveLength(1);
    const draft = db._db.draft_replies[0];
    expect(draft.lead_id).toBe(db._db.leads[0].id);
    expect(String(draft.body)).toContain("pickup");
    expect(draft.order_status).toBe("collecting");

    // order_status on the lead itself is not touched until the owner approves the draft.
    expect(db._db.leads[0].order_status).toBeFalsy();

    // The lead moved out of "new" as CRM data even though nothing was sent yet.
    expect(db._db.leads[0].stage).toBe("talking");
  });

  it("replaces the pending draft rather than stacking a second one for the same lead", async () => {
    const db = createDb({
      businesses: [makeBusiness({ auto_reply: true, reply_mode: "approve" })] as FakeDb["businesses"],
    });

    await processPayload(
      db,
      inboundTextPayload({ phoneNumberId: PHONE_NUMBER_ID, from: CUSTOMER, body: "Saya nak order 12 cupcakes" }),
    );
    expect(db._db.draft_replies).toHaveLength(1);
    const firstDraftId = db._db.draft_replies[0].id;

    // The owner hasn't approved yet, but the customer adds more detail before that happens.
    await processPayload(
      db,
      inboundTextPayload({ phoneNumberId: PHONE_NUMBER_ID, from: CUSTOMER, body: "Pickup esok pukul 10 pagi" }),
    );

    expect(db._db.draft_replies).toHaveLength(1);
    expect(db._db.draft_replies[0].id).toBe(firstDraftId);
    expect(db._db.draft_replies[0].order_status).toBe("awaiting_confirmation");
  });

  it("still flags pending_decision for a discount request, but sends no holding message", async () => {
    const db = createDb({
      businesses: [makeBusiness({ auto_reply: true, reply_mode: "approve" })] as FakeDb["businesses"],
    });

    await processPayload(
      db,
      inboundTextPayload({ phoneNumberId: PHONE_NUMBER_ID, from: CUSTOMER, body: "Boleh diskaun sikit tak?" }),
    );

    const lead = db._db.leads[0];
    expect(lead.pending_decision).toBe(true);
    expect(lead.human_reason).toBe("discount");
    // Auto mode would have sent the "let me check with the boss" filler here; approve mode sends
    // nothing at all, since the owner asked for full control over every send.
    expect(db._db.messages).toHaveLength(1);
    expect(db._db.messages[0].direction).toBe("in");
    expect(db._db.draft_replies).toHaveLength(0);
  });

  it("does nothing differently from auto mode when reply_mode is unset (back-compat default)", async () => {
    const db = createDb({
      businesses: [makeBusiness({ auto_reply: true })] as FakeDb["businesses"], // no reply_mode key at all
    });

    await processPayload(
      db,
      inboundTextPayload({ phoneNumberId: PHONE_NUMBER_ID, from: CUSTOMER, body: "Saya nak order 12 cupcakes" }),
    );

    expect(db._db.draft_replies).toHaveLength(0);
    expect(db._db.messages.filter((m) => m.source === "bot")).toHaveLength(1);
    expect(db._db.leads[0].order_status).toBe("collecting");
  });
});

describe("processPayload: subscription gating", () => {
  const daysFromNow = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();

  function dbWith(subscription: Record<string, unknown> | null, business: Record<string, unknown> = {}) {
    return createFakeSupabase({
      businesses: [makeBusiness({ auto_reply: true, ...business })] as FakeDb["businesses"],
      subscriptions: subscription ? [{ business_id: "biz-1", ...subscription }] : [],
    });
  }

  async function sendOrderMessage(db: ReturnType<typeof createFakeSupabase>) {
    await processPayload(
      db,
      inboundTextPayload({ phoneNumberId: PHONE_NUMBER_ID, from: CUSTOMER, body: "Saya nak order 12 cupcakes" }),
    );
  }

  it("replies normally during an unexpired trial", async () => {
    const db = dbWith({ status: "trialing", trial_ends_at: daysFromNow(5) });
    await sendOrderMessage(db);
    expect(db._db.messages.filter((m) => m.source === "bot")).toHaveLength(1);
  });

  it("replies normally on an active paid subscription", async () => {
    const db = dbWith({ status: "active", trial_ends_at: null });
    await sendOrderMessage(db);
    expect(db._db.messages.filter((m) => m.source === "bot")).toHaveLength(1);
  });

  it("stops replying once the trial has ended, and tells the owner why", async () => {
    const db = dbWith({ status: "trialing", trial_ends_at: daysFromNow(-1) });
    await sendOrderMessage(db);

    // Nothing went to the customer, and the lead was not touched by the AI.
    expect(db._db.messages).toHaveLength(1);
    expect(db._db.messages[0].direction).toBe("in");
    const lead = db._db.leads[0];
    expect(lead.pending_decision).toBe(true);
    expect(lead.human_reason).toBe("billing");
    expect(String(lead.handoff_note)).toMatch(/trial has ended/i);
    expect(lead.order_status).toBeFalsy();
  });

  it("stops replying when a payment has failed (past_due)", async () => {
    const db = dbWith({ status: "past_due", trial_ends_at: null });
    await sendOrderMessage(db);
    expect(db._db.messages).toHaveLength(1);
    expect(db._db.leads[0].human_reason).toBe("billing");
    expect(String(db._db.leads[0].handoff_note)).toMatch(/payment did not go through/i);
  });

  it("stops replying after cancellation", async () => {
    const db = dbWith({ status: "canceled", trial_ends_at: null });
    await sendOrderMessage(db);
    expect(db._db.messages).toHaveLength(1);
    expect(db._db.leads[0].human_reason).toBe("billing");
  });

  it("treats a missing subscription row as blocked, not as free access", async () => {
    const db = dbWith(null);
    await sendOrderMessage(db);
    expect(db._db.messages).toHaveLength(1);
    expect(db._db.leads[0].human_reason).toBe("billing");
  });

  it("makes no AI calls at all while blocked, even with the assistant switched off", async () => {
    // refreshLead (lead-field extraction) is an AI call too. With no subscription it must not
    // run, and there is nothing to flag because the owner never turned the assistant on.
    const db = dbWith({ status: "canceled" }, { auto_reply: false });
    await sendOrderMessage(db);
    const lead = db._db.leads[0];
    expect(lead.pending_decision).toBe(false);
    expect(lead.human_reason).toBeNull();
    expect(lead.need).toBeNull();
    expect(lead.stage).toBe("new");
  });

  it("flags billing once, not on every message while blocked", async () => {
    const db = dbWith({ status: "canceled" });
    await sendOrderMessage(db);
    const firstNote = db._db.leads[0].handoff_note;
    db._db.leads[0].handoff_note = "owner edited this";
    await processPayload(
      db,
      inboundTextPayload({ phoneNumberId: PHONE_NUMBER_ID, from: CUSTOMER, body: "Hello? Anyone there?" }),
    );
    expect(firstNote).toBeTruthy();
    expect(db._db.leads[0].handoff_note).toBe("owner edited this");
  });

  it("still honours STOP while blocked", async () => {
    const db = dbWith({ status: "canceled" }, { auto_reply: false });
    db._db.leads = [
      {
        id: "lead-1",
        business_id: "biz-1",
        wa_contact_number: CUSTOMER,
        name: "Test Customer",
        follow_up_consent: "unknown",
        consent_asked_at: null,
        awaiting_feedback: false,
        pending_decision: false,
        locked_fields: [],
        stage: "won",
      },
    ];
    await processPayload(db, inboundTextPayload({ phoneNumberId: PHONE_NUMBER_ID, from: CUSTOMER, body: "STOP" }));
    expect(db._db.leads[0].follow_up_consent).toBe("no");
  });

  it("does not run the feedback AI or accept follow-up consent while blocked", async () => {
    const db = dbWith({ status: "canceled" });
    db._db.leads = [
      {
        id: "lead-1",
        business_id: "biz-1",
        wa_contact_number: CUSTOMER,
        name: "Test Customer",
        follow_up_consent: "unknown",
        consent_asked_at: new Date().toISOString(),
        awaiting_feedback: true,
        pending_decision: false,
        locked_fields: [],
        stage: "won",
      },
    ];
    await processPayload(db, inboundTextPayload({ phoneNumberId: PHONE_NUMBER_ID, from: CUSTOMER, body: "5 sedap!" }));

    const lead = db._db.leads[0];
    // Still waiting for feedback: the AI feedback agent never ran, so nothing was consumed.
    expect(lead.awaiting_feedback).toBe(true);
    expect(db._db.feedback).toHaveLength(0);
    expect(db._db.messages.filter((m) => m.source === "bot")).toHaveLength(0);
    expect(lead.human_reason).toBe("billing");
  });
});

describe("isOptOut", () => {
  it.each(["STOP", "stop", "Stop.", "berhenti", "henti", "unsubscribe", "stop please", "STOP semua mesej", "berhenti hantar"])(
    "treats %j as an opt-out",
    (text) => expect(isOptOut(text)).toBe(true),
  );

  it.each([
    "batal order tadi",
    "batal",
    "stop at Shah Alam for delivery",
    "stop by the shop at 5",
    "please don't stop the delivery",
    "nak berhenti sekejap kat Shah Alam",
    "",
    "ok",
  ])("does not treat %j as an opt-out", (text) => expect(isOptOut(text)).toBe(false));
});

describe("isConsentYes", () => {
  it.each(["YA", "ya", "Ya.", "yes", "setuju", " YA! "])("accepts %j", (t) => expect(isConsentYes(t)).toBe(true));
  it.each(["ok", "okay", "boleh", "y", "ya ya betul", "ya tapi kurang sikit", "tak nak"])("rejects %j", (t) =>
    expect(isConsentYes(t)).toBe(false),
  );
});

describe("cancellations and consent in the chat flow", () => {
  function consentLead(overrides: Record<string, unknown> = {}) {
    return {
      id: "lead-1",
      business_id: "biz-1",
      wa_contact_number: CUSTOMER,
      name: "Test Customer",
      follow_up_consent: "unknown",
      consent_asked_at: new Date().toISOString(),
      awaiting_feedback: false,
      pending_decision: false,
      locked_fields: [],
      stage: "won",
      ...overrides,
    };
  }
  const outboundOffer = (body: string) => ({
    id: "m-out",
    lead_id: "lead-1",
    business_id: "biz-1",
    wa_message_id: "wamid.out1",
    direction: "out",
    body,
    source: "bot",
    sent_at: new Date(Date.now() - 60_000).toISOString(),
    created_at: new Date(Date.now() - 60_000).toISOString(),
  });

  it("does not switch off follow-ups when the customer cancels an order with 'batal'", async () => {
    const db = createDb({ businesses: [makeBusiness({ auto_reply: false })] as FakeDb["businesses"] });
    db._db.leads = [consentLead()];
    await processPayload(db, inboundTextPayload({ phoneNumberId: PHONE_NUMBER_ID, from: CUSTOMER, body: "batal order tadi" }));

    expect(db._db.leads[0].follow_up_consent).toBe("unknown");
    // No "we won't message you again" reply was sent.
    expect(db._db.messages.filter((m) => m.source === "bot")).toHaveLength(0);
  });

  it("records consent for YA sent straight after the offer", async () => {
    const db = createDb({ businesses: [makeBusiness({ auto_reply: true })] as FakeDb["businesses"] });
    db._db.leads = [consentLead()];
    db._db.messages = [outboundOffer(`Payment dah terima!\n\n${CONSENT_ASK}`)];
    await processPayload(db, inboundTextPayload({ phoneNumberId: PHONE_NUMBER_ID, from: CUSTOMER, body: "YA" }));

    expect(db._db.leads[0].follow_up_consent).toBe("yes");
  });

  it("does not record consent for a bare 'ok' after the offer", async () => {
    const db = createDb({ businesses: [makeBusiness({ auto_reply: true })] as FakeDb["businesses"] });
    db._db.leads = [consentLead()];
    db._db.messages = [outboundOffer(`Payment dah terima!\n\n${CONSENT_ASK}`)];
    await processPayload(db, inboundTextPayload({ phoneNumberId: PHONE_NUMBER_ID, from: CUSTOMER, body: "ok" }));

    expect(db._db.leads[0].follow_up_consent).toBe("unknown");
  });

  it("does not take a 'ya' that answers a later order summary as consent", async () => {
    const db = createDb({ businesses: [makeBusiness({ auto_reply: true })] as FakeDb["businesses"] });
    db._db.leads = [consentLead()];
    // The offer was sent earlier, but the last thing we said was an order summary.
    db._db.messages = [outboundOffer("Order summary: 12 cupcakes, esok 10am, atas nama Aina. Betul ke?")];
    await processPayload(db, inboundTextPayload({ phoneNumberId: PHONE_NUMBER_ID, from: CUSTOMER, body: "ya" }));

    expect(db._db.leads[0].follow_up_consent).toBe("unknown");
  });
});
