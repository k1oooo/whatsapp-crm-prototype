import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentResult } from "@/lib/ai";
import { HOLDING_FALLBACK } from "@/lib/ai";

// The agent is the one thing replaced here: each test decides what the AI "said", and everything
// after it (pricing, the safety net, saving, sending, the queue) is the real code.
const agent = vi.hoisted(() => ({
  next: null as unknown,
  /** What the narrow second question returns, or an Error to make it fail. */
  repair: [] as { item: string; qty: number }[] | Error,
  repairCalls: 0,
}));
vi.mock("@/lib/ai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai")>()),
  runAgent: vi.fn(async () => agent.next),
  extractOrderLines: vi.fn(async () => {
    agent.repairCalls++;
    if (agent.repair instanceof Error) throw agent.repair;
    return agent.repair;
  }),
}));

import { drainInboundJobs } from "@/lib/inbound-queue";
import { handleInboundJob, ingestPayload, processPayload } from "@/lib/whatsapp";
import { createFakeSupabase, type FakeDb } from "@/test/fake-supabase";
import { inboundTextPayload } from "@/test/webhook-fixtures";

const PHONE = "TEST_PHONE_NUMBER_ID";
const CUSTOMER = "60123456789";

const LEAD_FIELDS = { name: "Aina", need: "cupcakes", budget_myr: null, quoted_price_myr: null, deadline: null, stage: "negotiating", language: "bm" } as const;

function said(over: Partial<AgentResult> & { lines?: { item: string; qty: number }[]; status?: string; summary?: string | null }) {
  const { lines, status, summary, ...rest } = over;
  agent.next = {
    action: "reply",
    reason: null,
    reply: "Boleh kak!",
    note: null,
    order: { status: status ?? "none", summary: summary ?? null, lines: lines ?? [] },
    lead: { ...LEAD_FIELDS },
    ...rest,
  } as AgentResult;
}

function makeDb(opts: { replyMode?: "auto" | "approve"; priced?: boolean } = {}) {
  return createFakeSupabase({
    businesses: [
      { id: "biz-1", owner_id: "o1", name: "Test Bakery", wa_phone_number_id: PHONE, auto_reply: true, reply_mode: opts.replyMode ?? "auto", business_facts: null, tone_notes: null, wa_access_token: null, payment_details: "Maybank 1234" },
    ],
    subscriptions: [{ business_id: "biz-1", status: "active", trial_ends_at: null, current_period_end: null }],
    knowledge_entries:
      opts.priced === false
        ? [{ id: "k0", business_id: "biz-1", category: "menu", title: "Cupcakes", content: "RM3 each" }]
        : [
            { id: "k1", business_id: "biz-1", category: "menu", title: "Cupcakes", content: "Chocolate or vanilla. Minimum 12.", price_myr: 3 },
            { id: "k2", business_id: "biz-1", category: "location", title: "Delivery", content: "Shah Alam only.", price_myr: 10 },
            { id: "k3", business_id: "biz-1", category: "faq", title: "Custom designs?", content: "Ask the owner." },
          ],
  } as FakeDb);
}

const send = (db: ReturnType<typeof makeDb>, body: string, id?: string) =>
  processPayload(db, inboundTextPayload({ phoneNumberId: PHONE, from: CUSTOMER, body, ...(id ? { messageId: id } : {}) } as never));
const botMessages = (db: ReturnType<typeof makeDb>) => db._db.messages.filter((m) => m.source === "bot");
const lead = (db: ReturnType<typeof makeDb>) => db._db.leads[0];

beforeEach(() => {
  agent.repair = [];
  agent.repairCalls = 0;
  delete process.env.AI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.WHATSAPP_SEND_MODE;
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("priced orders: the server computes the total", () => {
  it("fills {TOTAL} from the menu prices and stores the lines and total", async () => {
    const db = makeDb();
    said({ reply: "12 cupcake + delivery, total {TOTAL} ya. Betul ke?", status: "awaiting_confirmation", summary: "12 cupcakes + delivery", lines: [{ item: "P1", qty: 12 }, { item: "P2", qty: 1 }] });
    await send(db, "nak 12 cupcake, hantar Shah Alam");

    expect(botMessages(db)[0].body).toContain("total RM46 ya");
    expect(lead(db).order_total_myr).toBe(46);
    expect(lead(db).quoted_price_myr).toBe(46);
    expect(lead(db).order_lines).toEqual([
      { entry_id: "k1", title: "Cupcakes", qty: 12, unit_myr: 3, subtotal_myr: 36 },
      { entry_id: "k2", title: "Delivery", qty: 1, unit_myr: 10, subtotal_myr: 10 },
    ]);
  });

  it("REGRESSION: an invented total never reaches the customer, the owner is asked instead", async () => {
    const db = makeDb();
    said({ reply: "Total RM77 ya.", status: "awaiting_confirmation", lines: [{ item: "P1", qty: 12 }] });
    await send(db, "nak 12 cupcake");

    expect(botMessages(db).map((m) => m.body).join(" ")).not.toContain("RM77");
    expect(lead(db).pending_decision).toBe(true);
    expect(lead(db).order_total_myr).toBeNull();
  });

  it("does not trust a total the AI worked out itself, even if it is arithmetically right for other items", async () => {
    const db = makeDb();
    // The AI says RM37 where the server computes RM36.
    said({ reply: "12 x RM3 = RM37 ya", status: "awaiting_confirmation", lines: [{ item: "P1", qty: 12 }] });
    await send(db, "nak 12 cupcake");
    expect(botMessages(db).map((m) => m.body).join(" ")).not.toContain("RM37");
    expect(lead(db).pending_decision).toBe(true);
  });

  it("allows a line subtotal and a unit price the server computed or the menu states", async () => {
    const db = makeDb();
    said({ reply: "12 x RM3 = RM36, total {TOTAL}", status: "awaiting_confirmation", lines: [{ item: "P1", qty: 12 }] });
    await send(db, "nak 12 cupcake");
    expect(botMessages(db)[0].body).toBe("12 x RM3 = RM36, total RM36");
  });

  it("hands over when the AI names an item that is not on the menu", async () => {
    const db = makeDb();
    said({ reply: "Total {TOTAL}", status: "awaiting_confirmation", lines: [{ item: "P9", qty: 2 }] });
    await send(db, "nak kek");
    expect(lead(db).pending_decision).toBe(true);
    expect(lead(db).order_lines).toBeNull();
    expect(botMessages(db).every((m) => !String(m.body).includes("{TOTAL}"))).toBe(true);
  });

  it("hands over when an order is summarised without lines on a priced menu", async () => {
    const db = makeDb();
    said({ reply: "Pesanan awak 12 cupcake ya. Betul ke?", status: "awaiting_confirmation", summary: "12 cupcakes", lines: [] });
    await send(db, "nak 12 cupcake");
    expect(lead(db).pending_decision).toBe(true);
    expect(lead(db).order_status ?? "none").not.toBe("awaiting_confirmation");
  });

  it("never sends the literal {TOTAL} when there is no order to total", async () => {
    const db = makeDb();
    said({ reply: "Total {TOTAL} ya", status: "none", lines: [] });
    await send(db, "berapa harga?");
    expect(botMessages(db).every((m) => !String(m.body).includes("{TOTAL}"))).toBe(true);
    expect(lead(db).pending_decision).toBe(true);
  });

  it("keeps the stored total when the customer just says ok and the AI sends no lines", async () => {
    const db = makeDb();
    said({ reply: "Total {TOTAL}. Betul ke?", status: "awaiting_confirmation", lines: [{ item: "P1", qty: 12 }] });
    await send(db, "nak 12 cupcake");
    said({ reply: "Terima kasih! Jumlah {TOTAL}.", status: "confirmed", summary: "12 cupcakes", lines: [] });
    // The fake database stamps rows to the millisecond. A real one stamps to the microsecond, so two
    // rows written one after the other never tie there. Without a pause the messages tie here.
    await new Promise((r) => setTimeout(r, 5));
    await send(db, "ok betul", "wamid.second");
    expect(botMessages(db).at(-1)!.body).toContain("Jumlah RM36");
    expect(lead(db).order_total_myr).toBe(36);
  });

  it("stores the lines and total on the draft in approve mode", async () => {
    const db = makeDb({ replyMode: "approve" });
    said({ reply: "Total {TOTAL} ya", status: "awaiting_confirmation", lines: [{ item: "P1", qty: 12 }] });
    await send(db, "nak 12 cupcake");
    expect(botMessages(db)).toHaveLength(0);
    expect(db._db.draft_replies[0]).toMatchObject({ order_total_myr: 36, body: expect.stringContaining("RM36") });
  });

  it("a business with no priced items keeps the old behaviour and gets no totals", async () => {
    const db = makeDb({ priced: false });
    said({ reply: "Cupcake RM3 satu ya.", status: "none" });
    await send(db, "berapa harga cupcake?");
    expect(botMessages(db)[0].body).toBe("Cupcake RM3 satu ya.");
    expect(lead(db).order_total_myr).toBeNull();
  });
});

describe("item codes never reach the customer", () => {
  it("REGRESSION: a code the model copies into its reply is removed, and the chat is not handed over", async () => {
    // Seen in practice: the menu text shows "Cupcakes [P1]", the model repeated it, and the placeholder
    // check mistook the code for an unfilled [BANK NAME] and handed the chat to the owner.
    const db = makeDb();
    said({
      reply: "Order summary: 12 x Cupcakes [P1], chocolate, esok 4pm, atas nama mike. Jumlah {TOTAL}. Betul ke?",
      status: "awaiting_confirmation",
      summary: "12 x Cupcakes [P1], chocolate, esok 4pm",
      lines: [{ item: "P1", qty: 12 }],
    });
    await send(db, "mike");

    const sent = botMessages(db)[0].body as string;
    expect(sent).toBe("Order summary: 12 x Cupcakes, chocolate, esok 4pm, atas nama mike. Jumlah RM36. Betul ke?");
    expect(sent).not.toMatch(/\[P\d+\]/);
    expect(lead(db).pending_decision).toBeFalsy();
    expect(lead(db).order_summary).toBe("12 x Cupcakes, chocolate, esok 4pm");
    expect(lead(db).order_total_myr).toBe(36);
  });

  it("removes a made up code too", async () => {
    const db = makeDb();
    said({ reply: "Boleh kak, Cupcakes [P9] RM3 each.", status: "none", lines: [] });
    await send(db, "berapa cupcake?");
    expect(botMessages(db)[0].body).toBe("Boleh kak, Cupcakes RM3 each.");
  });

  it("a real unfilled placeholder is still caught, and the note says which one", async () => {
    const db = makeDb();
    said({ reply: "Sila transfer ke [BANK NAME] ya.", status: "none", lines: [] });
    await send(db, "macam mana bayar?");
    expect(botMessages(db).every((m) => !String(m.body).includes("[BANK NAME]"))).toBe(true);
    expect(lead(db).pending_decision).toBe(true);
    expect(String(lead(db).handoff_note)).toContain("[BANK NAME]");
  });
});

describe("when the agent sends no usable order lines", () => {
  it("REGRESSION: asks once more instead of handing a plain order to the owner", async () => {
    const db = makeDb();
    // What happened in practice: a complete order summary, and an empty lines list.
    said({ reply: "Total {TOTAL} ya. Betul ke?", status: "awaiting_confirmation", summary: "12 chocolate cupcakes, esok 2pm", lines: [] });
    agent.repair = [{ item: "P1", qty: 12 }];
    await send(db, "choc pickup esok 2pm atas nama faiz");

    expect(agent.repairCalls).toBe(1);
    expect(botMessages(db)[0].body).toContain("Total RM36 ya");
    expect(lead(db).order_total_myr).toBe(36);
    expect(lead(db).pending_decision).toBeFalsy();
  });

  it("repairs lines that were not on the menu too", async () => {
    const db = makeDb();
    said({ reply: "Total {TOTAL}", status: "awaiting_confirmation", lines: [{ item: "cupcakes", qty: 12 }] });
    agent.repair = [{ item: "P1", qty: 12 }];
    await send(db, "nak 12 cupcake");
    expect(botMessages(db)[0].body).toBe("Total RM36");
  });

  it("still hands over when the second question gives nothing usable", async () => {
    const db = makeDb();
    said({ reply: "Total {TOTAL}", status: "awaiting_confirmation", lines: [] });
    agent.repair = [];
    await send(db, "nak 12 cupcake");
    expect(agent.repairCalls).toBe(1);
    expect(lead(db).pending_decision).toBe(true);
    expect(botMessages(db).every((m) => !String(m.body).includes("{TOTAL}"))).toBe(true);
  });

  it("still hands over when the second question itself fails", async () => {
    const db = makeDb();
    said({ reply: "Total {TOTAL}", status: "awaiting_confirmation", lines: [] });
    agent.repair = new Error("AI timeout");
    await send(db, "nak 12 cupcake");
    expect(lead(db).pending_decision).toBe(true);
  });

  it("does not ask when there is no order yet", async () => {
    const db = makeDb();
    said({ reply: "Boleh kak, nak perisa apa?", status: "collecting", lines: [] });
    await send(db, "nak order cupcake");
    expect(agent.repairCalls).toBe(0);
    expect(lead(db).pending_decision).toBeFalsy();
  });

  it("does not ask when the order has not changed and its total is already stored", async () => {
    const db = makeDb();
    said({ reply: "Total {TOTAL}", status: "awaiting_confirmation", lines: [{ item: "P1", qty: 12 }] });
    await send(db, "nak 12 cupcake");
    said({ reply: "Terima kasih! Jumlah {TOTAL}.", status: "confirmed", summary: "12 cupcakes", lines: [] });
    await new Promise((r) => setTimeout(r, 5));
    await send(db, "ok betul", "wamid.ok");
    expect(agent.repairCalls).toBe(0);
    expect(botMessages(db).at(-1)!.body).toContain("Jumlah RM36");
  });

  it("never prices a CHANGED order with the stored lines of the old one", async () => {
    const db = makeDb();
    said({ reply: "Total {TOTAL}", status: "awaiting_confirmation", lines: [{ item: "P1", qty: 12 }] });
    await send(db, "nak 12 cupcake");
    expect(lead(db).order_total_myr).toBe(36);

    // The customer changes the order; the agent sends a bad line and the repair finds nothing.
    said({ reply: "Total {TOTAL}", status: "awaiting_confirmation", lines: [{ item: "P9", qty: 24 }] });
    agent.repair = [];
    await new Promise((r) => setTimeout(r, 5));
    await send(db, "tukar jadi 24", "wamid.change");
    expect(botMessages(db).at(-1)!.body).not.toContain("RM36");
    expect(lead(db).pending_decision).toBe(true);
  });
});

describe("the inbound queue in the webhook flow", () => {
  it("ingest stores the message and queues work, but does no AI and sends nothing", async () => {
    const db = makeDb();
    said({});
    await ingestPayload(db, inboundTextPayload({ phoneNumberId: PHONE, from: CUSTOMER, body: "hi" }));
    expect(db._db.messages).toHaveLength(1);
    expect(botMessages(db)).toHaveLength(0);
    expect(db._db.inbound_jobs).toHaveLength(1);
  });

  it("REGRESSION: two quick messages from one customer get one reply, not two", async () => {
    const db = makeDb();
    said({ reply: "Boleh kak, nak berapa?" });
    await ingestPayload(db, inboundTextPayload({ phoneNumberId: PHONE, from: CUSTOMER, body: "hi", messageId: "wamid.a" } as never));
    await ingestPayload(db, inboundTextPayload({ phoneNumberId: PHONE, from: CUSTOMER, body: "ada cupcake?", messageId: "wamid.b" } as never));
    expect(db._db.inbound_jobs).toHaveLength(1); // the second message joined the waiting job

    await drainInboundJobs(db, (job) => handleInboundJob(db, job));
    expect(botMessages(db)).toHaveLength(1);
  });

  it("a crash mid-reply loses nothing: the job is retried and the customer is answered once", async () => {
    const db = makeDb();
    said({ reply: "Boleh kak!" });
    await ingestPayload(db, inboundTextPayload({ phoneNumberId: PHONE, from: CUSTOMER, body: "hi" }));

    // First attempt: the worker blows up before anything is sent.
    await drainInboundJobs(db, async () => {
      throw new Error("function timed out");
    });
    expect(botMessages(db)).toHaveLength(0);
    expect(db._db.inbound_jobs[0].status).toBe("queued");

    // The retry time arrives and a worker picks it up.
    db._db.inbound_jobs[0].run_after = new Date(Date.now() - 1).toISOString();
    await drainInboundJobs(db, (job) => handleInboundJob(db, job));
    expect(botMessages(db)).toHaveLength(1);
    expect(db._db.inbound_jobs[0].status).toBe("done");
  });

  it("a delivery Meta repeats is queued again only while nobody has answered it", async () => {
    const db = makeDb();
    said({ reply: "Boleh kak!" });
    const payload = inboundTextPayload({ phoneNumberId: PHONE, from: CUSTOMER, body: "hi", messageId: "wamid.dup" } as never);

    await ingestPayload(db, payload); // crashed before the job ran: Meta sends it again
    await ingestPayload(db, payload);
    expect(db._db.messages).toHaveLength(1);
    expect(db._db.inbound_jobs).toHaveLength(1);

    await drainInboundJobs(db, (job) => handleInboundJob(db, job));
    expect(botMessages(db)).toHaveLength(1);

    await ingestPayload(db, payload); // repeated after it was answered
    expect(db._db.inbound_jobs.filter((j) => j.status === "queued")).toHaveLength(0);
    expect(botMessages(db)).toHaveLength(1);
  });

  it("a job for a chat whose business was deleted just finishes", async () => {
    const db = makeDb();
    await expect(handleInboundJob(db, { business_id: "gone", lead_id: "x" })).resolves.toBeUndefined();
  });

  it("falls back to the holding reply text constant when escalating", () => {
    expect(HOLDING_FALLBACK).toBeTruthy();
  });
});
