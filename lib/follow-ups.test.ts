import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetAlertCooldowns } from "@/lib/alert";
import { STUCK_AFTER_MS, dueAt, recoverStuckFollowUps, runDueFollowUps, scheduleAfterPayment } from "@/lib/follow-ups";
import { readSettings } from "@/lib/follow-up-settings";
import { createFakeSupabase, type FakeDb } from "@/test/fake-supabase";

const NOW = Date.parse("2026-10-05T03:00:00.000Z"); // 11:00 in Kuala Lumpur
const iso = (ms: number) => new Date(ms).toISOString();

function setup(over: { lead?: Record<string, unknown>; business?: Record<string, unknown>; sub?: Record<string, unknown> | null; fu?: Record<string, unknown> } = {}) {
  return createFakeSupabase({
    businesses: [{ id: "biz-1", owner_id: "o1", wa_phone_number_id: "TEST", wa_access_token: null, follow_up_settings: {}, ...over.business }],
    leads: [
      {
        id: "lead-1", business_id: "biz-1", wa_contact_number: "60123456789", name: "Aina", need: "cupcakes",
        order_summary: "12 cupcakes", follow_up_consent: "yes", pending_decision: false,
        last_inbound_at: iso(NOW - 3600_000), paid_at: "2026-10-03T00:00:00.000Z", ...over.lead,
      },
    ],
    subscriptions: over.sub === null ? [] : [{ business_id: "biz-1", status: "active", trial_ends_at: null, current_period_end: null, ...over.sub }],
    follow_ups: [
      { id: "fu-1", business_id: "biz-1", lead_id: "lead-1", kind: "feedback", status: "scheduled", due_at: iso(NOW - 1000), order_key: "2026-10-03T00:00:00.000Z", ...over.fu },
    ],
  } as FakeDb);
}
const fu = (db: ReturnType<typeof setup>) => db._db.follow_ups[0];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  delete process.env.WHATSAPP_SEND_MODE;
  delete process.env.ALERT_WEBHOOK_URL;
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  resetAlertCooldowns();
});

describe("runDueFollowUps", () => {
  it("sends a due follow-up once and records it in the chat", async () => {
    const db = setup();
    expect(await runDueFollowUps(db)).toEqual({ sent: 1, skipped: 0, failed: 0, waiting: 0 });
    expect(fu(db).status).toBe("sent");
    expect(db._db.messages).toHaveLength(1);
    expect(db._db.messages[0]).toMatchObject({ source: "bot", direction: "out" });
    expect(db._db.leads[0].awaiting_feedback).toBe(true);
  });

  it("running again does not send it a second time", async () => {
    const db = setup();
    await runDueFollowUps(db);
    await runDueFollowUps(db);
    expect(db._db.messages).toHaveLength(1);
  });

  it("two runs at the same moment send it once", async () => {
    const db = setup();
    await Promise.all([runDueFollowUps(db), runDueFollowUps(db)]);
    expect(db._db.messages).toHaveLength(1);
  });

  it("stays quiet at night in Kuala Lumpur unless a button was pressed", async () => {
    // Due since the day before, so only the quiet hours can be what holds it back.
    const db = setup({ fu: { due_at: "2026-10-03T00:00:00.000Z" } });
    vi.setSystemTime(Date.parse("2026-10-04T17:00:00.000Z")); // 01:00 KL
    expect(await runDueFollowUps(db)).toEqual({ sent: 0, skipped: 0, failed: 0, waiting: 0 });
    expect(fu(db).status).toBe("scheduled");
    expect((await runDueFollowUps(db, { ignoreQuietHours: true })).sent).toBe(1);
  });

  it("skips a customer who opted out, and waits for one who has not agreed", async () => {
    const out = setup({ lead: { follow_up_consent: "no" } });
    expect((await runDueFollowUps(out)).skipped).toBe(1);
    expect(fu(out).status).toBe("skipped");

    const unknown = setup({ lead: { follow_up_consent: "unknown" } });
    expect((await runDueFollowUps(unknown)).waiting).toBe(1);
    expect(fu(unknown).status).toBe("scheduled");
    expect(unknown._db.messages).toHaveLength(0);
  });

  it("holds the message while the subscription is not active, and while the chat needs the owner", async () => {
    const lapsed = setup({ sub: { status: "canceled" } });
    expect((await runDueFollowUps(lapsed)).waiting).toBe(1);
    expect(lapsed._db.messages).toHaveLength(0);

    const none = setup({ sub: null });
    expect((await runDueFollowUps(none)).waiting).toBe(1);

    const busy = setup({ lead: { pending_decision: true } });
    expect((await runDueFollowUps(busy)).waiting).toBe(1);
    expect(busy._db.messages).toHaveLength(0);
  });

  it("skips a follow-up for an order the customer has since replaced", async () => {
    const db = setup({ lead: { paid_at: "2026-10-04T00:00:00.000Z" } });
    expect((await runDueFollowUps(db)).skipped).toBe(1);
    expect(fu(db).detail).toMatch(/newer order/i);
  });

  it("fails a follow-up whose send throws, without sending anything or taking down the others", async () => {
    process.env.WHATSAPP_SEND_MODE = "live";
    process.env.WHATSAPP_ACCESS_TOKEN = "t";
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 500 })));
    const db = setup();
    expect((await runDueFollowUps(db)).failed).toBe(1);
    expect(fu(db).status).toBe("failed");
    expect(db._db.messages).toHaveLength(0);
    vi.unstubAllGlobals();
    delete process.env.WHATSAPP_ACCESS_TOKEN;
    delete process.env.WHATSAPP_SEND_MODE;
  });

  it("sends nothing that is not due yet", async () => {
    const db = setup({ fu: { due_at: iso(NOW + 3600_000) } });
    expect((await runDueFollowUps(db)).sent).toBe(0);
  });

  it("limits a run to one business when asked", async () => {
    const db = setup();
    expect((await runDueFollowUps(db, { businessId: "someone-else" })).sent).toBe(0);
    expect((await runDueFollowUps(db, { businessId: "biz-1" })).sent).toBe(1);
  });
});

describe("recoverStuckFollowUps", () => {
  it("marks a follow-up stuck in sending as failed, and never re-sends it", async () => {
    const db = setup({ fu: { status: "sending", claimed_at: iso(NOW - STUCK_AFTER_MS - 1000) } });
    expect(await recoverStuckFollowUps(db, undefined, () => NOW)).toBe(1);
    expect(fu(db).status).toBe("failed");
    expect(fu(db).detail).toMatch(/may or may not have reached/i);
    await runDueFollowUps(db);
    expect(db._db.messages).toHaveLength(0);
  });

  it("leaves a follow-up that was only just claimed", async () => {
    const db = setup({ fu: { status: "sending", claimed_at: iso(NOW - 60_000) } });
    expect(await recoverStuckFollowUps(db, undefined, () => NOW)).toBe(0);
    expect(fu(db).status).toBe("sending");
  });

  it("judges a row claimed before migration 0016 (no claimed_at) by its due time", async () => {
    const old = setup({ fu: { status: "sending", claimed_at: null, due_at: iso(NOW - 3600_000) } });
    expect(await recoverStuckFollowUps(old, undefined, () => NOW)).toBe(1);
    const recent = setup({ fu: { status: "sending", claimed_at: null, due_at: iso(NOW - 60_000) } });
    expect(await recoverStuckFollowUps(recent, undefined, () => NOW)).toBe(0);
  });

  it("is run before each batch, so a stuck row is reported without anyone asking", async () => {
    const db = setup({ fu: { status: "sending", claimed_at: iso(NOW - STUCK_AFTER_MS - 1000) } });
    await runDueFollowUps(db);
    expect(fu(db).status).toBe("failed");
  });

  it("raises an alert when it finds one", async () => {
    process.env.ALERT_WEBHOOK_URL = "https://hooks.example/x";
    const f = vi.fn(async () => new Response("ok"));
    vi.stubGlobal("fetch", f);
    const db = setup({ fu: { status: "sending", claimed_at: iso(NOW - STUCK_AFTER_MS - 1000) } });
    await recoverStuckFollowUps(db, undefined, () => NOW);
    expect(f).toHaveBeenCalledTimes(1);
    expect(String((f.mock.calls[0] as unknown as [string, RequestInit])[1].body)).toMatch(/stopped while sending/i);
    vi.unstubAllGlobals();
  });
});

describe("scheduleAfterPayment and dueAt", () => {
  it("queues the feedback and reorder follow-ups for an order, once", async () => {
    const db = createFakeSupabase({ businesses: [{ id: "biz-1", owner_id: "o1" }], leads: [{ id: "lead-1", business_id: "biz-1", wa_contact_number: "601" }] } as FakeDb);
    const args = { businessId: "biz-1", leadId: "lead-1", deadline: "2026-10-10", paidAt: "2026-10-05T03:00:00.000Z", settings: readSettings({ feedback: { enabled: true }, reorder: { enabled: true } }) };
    await scheduleAfterPayment(db, args);
    await scheduleAfterPayment(db, args); // paying twice must not queue twice
    const kinds = db._db.follow_ups.map((f) => f.kind).sort();
    expect(kinds).toEqual(["feedback", "reorder"]);
  });

  it("puts a follow-up at 10:00 Malaysia time, some days after the delivery date", () => {
    expect(dueAt("2026-10-10", 1)).toBe("2026-10-11T02:00:00.000Z");
  });
});
