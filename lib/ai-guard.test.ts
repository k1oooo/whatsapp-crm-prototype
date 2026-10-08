import { afterEach, describe, expect, it } from "vitest";
import { createFakeSupabase } from "@/test/fake-supabase";
import { dailyMessageLimit, flagDailyLimit, overDailyLimit } from "@/lib/ai-guard";

afterEach(() => {
  delete process.env.AI_DAILY_MESSAGE_LIMIT;
});

const msg = (business_id: string, created_at = new Date().toISOString()) => ({ business_id, lead_id: "l1", direction: "in", body: "x", created_at });

describe("ai-guard", () => {
  it("defaults to 1000 and ignores a bad AI_DAILY_MESSAGE_LIMIT", () => {
    expect(dailyMessageLimit()).toBe(1000);
    process.env.AI_DAILY_MESSAGE_LIMIT = "abc";
    expect(dailyMessageLimit()).toBe(1000);
    process.env.AI_DAILY_MESSAGE_LIMIT = "-5";
    expect(dailyMessageLimit()).toBe(1000);
    process.env.AI_DAILY_MESSAGE_LIMIT = "50";
    expect(dailyMessageLimit()).toBe(50);
  });

  it("counts only this business's messages from the last 24 hours", async () => {
    process.env.AI_DAILY_MESSAGE_LIMIT = "3";
    const old = new Date(Date.now() - 3 * 86_400_000).toISOString();
    const db = createFakeSupabase({ messages: [msg("a"), msg("a"), msg("a", old), msg("b"), msg("b"), msg("b")] });
    expect(await overDailyLimit(db as never, "a")).toBe(false);
    expect(await overDailyLimit(db as never, "b")).toBe(true);
  });

  it("flags a chat once and does not overwrite an existing handover", async () => {
    const db = createFakeSupabase({
      leads: [
        { id: "fresh", business_id: "a", pending_decision: false },
        { id: "waiting", business_id: "a", pending_decision: true, human_reason: "discount", handoff_note: "wants 20% off" },
      ],
    });
    await flagDailyLimit(db as never, "fresh");
    await flagDailyLimit(db as never, "waiting");
    const [fresh, waiting] = db._db.leads;
    expect(fresh.pending_decision).toBe(true);
    expect(fresh.handoff_note).toMatch(/daily limit/i);
    expect(waiting.handoff_note).toBe("wants 20% off");
  });
});
