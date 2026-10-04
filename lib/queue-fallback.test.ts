import { beforeEach, describe, expect, it, vi } from "vitest";
import { isQueueUnavailable } from "@/lib/inbound-queue";
import { ingestPayload, processPayload, runInboundWork } from "@/lib/whatsapp";
import { createFakeSupabase, type FakeDb } from "@/test/fake-supabase";
import { inboundTextPayload } from "@/test/webhook-fixtures";

const PHONE = "TEST_PHONE_NUMBER_ID";
const CUSTOMER = "60123456789";

function makeDb(missing: string[] = []) {
  return createFakeSupabase(
    {
      businesses: [{ id: "biz-1", owner_id: "o1", name: "Test Bakery", wa_phone_number_id: PHONE, auto_reply: true, reply_mode: "auto", business_facts: null, tone_notes: null, wa_access_token: null }],
      subscriptions: [{ business_id: "biz-1", status: "active", trial_ends_at: null, current_period_end: null }],
    } as FakeDb,
    { missingTables: missing },
  );
}
const payload = (body = "Hi kak", messageId?: string) =>
  inboundTextPayload({ phoneNumberId: PHONE, from: CUSTOMER, body, ...(messageId ? { messageId } : {}) } as never);
const botMessages = (db: ReturnType<typeof makeDb>) => db._db.messages.filter((m) => m.source === "bot");

beforeEach(() => {
  delete process.env.AI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.WHATSAPP_SEND_MODE;
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("isQueueUnavailable", () => {
  it.each([
    { code: "42P01", message: 'relation "public.inbound_jobs" does not exist' },
    { code: "PGRST205", message: "Could not find the table 'public.inbound_jobs' in the schema cache" },
    { code: "PGRST202", message: "Could not find the function public.claim_inbound_jobs in the schema cache" },
    { code: "42883", message: "function claim_inbound_jobs(integer) does not exist" },
  ])("recognises %j as a missing queue", (err) => expect(isQueueUnavailable(err)).toBe(true));

  it.each([
    null,
    undefined,
    "boom",
    new Error("network down"),
    { code: "23505", message: "duplicate key value" },
    { code: "XX000", message: "internal error" },
    { code: "42P01", message: 'relation "public.leads" does not exist' },
  ])("does not mistake %j for a missing queue", (err) => expect(isQueueUnavailable(err)).toBe(false));
});

describe("without migration 0015 (no inbound_jobs table)", () => {
  it("REGRESSION: the webhook still stores the message and does not fail", async () => {
    const db = makeDb(["inbound_jobs"]);
    const { inline } = await ingestPayload(db, payload());
    expect(db._db.messages).toHaveLength(1);
    expect(inline).toEqual([{ business_id: "biz-1", lead_id: db._db.leads[0].id }]);
  });

  it("answers the customer once, directly, like before the queue existed", async () => {
    const db = makeDb(["inbound_jobs"]);
    await processPayload(db, payload());
    expect(botMessages(db)).toHaveLength(1);
  });

  it("hands each chat back only once even when a payload has several messages for it", async () => {
    const db = makeDb(["inbound_jobs"]);
    const first = inboundTextPayload({ phoneNumberId: PHONE, from: CUSTOMER, body: "hi", messageId: "wamid.1" } as never);
    const second = inboundTextPayload({ phoneNumberId: PHONE, from: CUSTOMER, body: "ada cupcake?", messageId: "wamid.2" } as never);
    first.entry![0]!.changes![0]!.value!.messages!.push(second.entry![0]!.changes![0]!.value!.messages![0]!);
    const { inline } = await ingestPayload(db, first);
    expect(inline).toHaveLength(1);
    expect(db._db.messages).toHaveLength(2);
  });

  it("the cron sweeper does nothing instead of failing", async () => {
    const db = makeDb(["inbound_jobs"]);
    await expect(runInboundWork(db, [], { budgetMs: 1000 })).resolves.toEqual({ done: 0, retried: 0, failed: 0 });
  });

  it("one chat failing to be handled does not stop the others", async () => {
    const db = makeDb(["inbound_jobs"]);
    const handled = await runInboundWork(db, [
      { business_id: "gone", lead_id: "x" },
      { business_id: "biz-1", lead_id: "also-missing" },
    ]);
    expect(handled).toEqual({ done: 0, retried: 0, failed: 0 });
  });
});

describe("with the queue in place nothing is handed back", () => {
  it("ingest queues the work and returns no inline chats", async () => {
    const db = makeDb();
    const { inline } = await ingestPayload(db, payload());
    expect(inline).toEqual([]);
    expect(db._db.inbound_jobs).toHaveLength(1);
  });
});
