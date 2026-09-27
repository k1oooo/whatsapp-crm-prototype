import crypto from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { processPayload, verifySignature } from "@/lib/whatsapp";
import { createFakeSupabase, type FakeDb } from "@/test/fake-supabase";
import { inboundMediaPayload, inboundTextPayload, signPayload } from "@/test/webhook-fixtures";

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
    const db = createFakeSupabase({ businesses: [makeBusiness({ auto_reply: true })] as FakeDb["businesses"] });

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
    const db = createFakeSupabase({ businesses: [makeBusiness()] as FakeDb["businesses"] });

    await processPayload(db, inboundTextPayload({ phoneNumberId: PHONE_NUMBER_ID, from: "60111111111", body: "Hi" }));
    await processPayload(db, inboundTextPayload({ phoneNumberId: PHONE_NUMBER_ID, from: "60222222222", body: "Hi" }));

    expect(db._db.leads).toHaveLength(2);
  });
});

describe("processPayload: order-status transitions", () => {
  it("walks collecting -> awaiting_confirmation -> confirmed, then stays paid after a manual mark-as-paid", async () => {
    const db = createFakeSupabase({
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
    const db = createFakeSupabase({ businesses: [makeBusiness({ auto_reply: true })] as FakeDb["businesses"] });
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
    const db = createFakeSupabase({ businesses: [makeBusiness({ auto_reply: true })] as FakeDb["businesses"] });

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
    const db = createFakeSupabase({
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
    const db = createFakeSupabase({ businesses: [makeBusiness({ auto_reply: true })] as FakeDb["businesses"] });

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
    const db = createFakeSupabase({ businesses: [makeBusiness({ auto_reply: true })] as FakeDb["businesses"] });

    await processPayload(
      db,
      inboundMediaPayload({ phoneNumberId: PHONE_NUMBER_ID, from: CUSTOMER, mediaType: "audio" }),
    );

    const lead = db._db.leads[0];
    expect(lead.pending_decision).toBe(true);
    expect(lead.human_reason).toBe("unsure");
  });

  it("does not auto-reply at all when auto_reply is off for the business", async () => {
    const db = createFakeSupabase({ businesses: [makeBusiness({ auto_reply: false })] as FakeDb["businesses"] });

    await processPayload(
      db,
      inboundTextPayload({ phoneNumberId: PHONE_NUMBER_ID, from: CUSTOMER, body: "Hi, nak order boleh?" }),
    );

    // Only the inbound customer message exists; nothing was sent back.
    expect(db._db.messages).toHaveLength(1);
    expect(db._db.messages[0].direction).toBe("in");
  });

  it("honours STOP immediately, even when auto_reply is off", async () => {
    const db = createFakeSupabase({ businesses: [makeBusiness({ auto_reply: false })] as FakeDb["businesses"] });

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
