import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LEASE_SECONDS,
  MAX_ATTEMPTS,
  claimInboundJobs,
  deleteFinishedJobs,
  drainInboundJobs,
  enqueueInbound,
  failJob,
} from "@/lib/inbound-queue";
import { resetAlertCooldowns } from "@/lib/alert";
import { createFakeSupabase, type FakeDb } from "@/test/fake-supabase";

function setup() {
  const db = createFakeSupabase({
    businesses: [{ id: "biz-1", owner_id: "o1", wa_phone_number_id: "111" }],
    leads: [
      { id: "lead-1", business_id: "biz-1", wa_contact_number: "601" },
      { id: "lead-2", business_id: "biz-1", wa_contact_number: "602" },
    ],
  } as FakeDb);
  return db;
}
const jobs = (db: ReturnType<typeof setup>) => db._db.inbound_jobs ?? [];

let db: ReturnType<typeof setup>;
beforeEach(() => {
  db = setup();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("enqueueInbound", () => {
  it("queues one job per chat and folds a second message into the waiting one", async () => {
    await enqueueInbound(db, "biz-1", "lead-1");
    await enqueueInbound(db, "biz-1", "lead-1");
    await enqueueInbound(db, "biz-1", "lead-2");
    expect(jobs(db).map((j) => j.lead_id).sort()).toEqual(["lead-1", "lead-2"]);
  });

  it("queues a new job while one is running, so a message that arrives mid-reply is not lost", async () => {
    await enqueueInbound(db, "biz-1", "lead-1");
    await claimInboundJobs(db);
    await enqueueInbound(db, "biz-1", "lead-1");
    expect(jobs(db).map((j) => j.status).sort()).toEqual(["queued", "running"]);
  });
});

describe("claimInboundJobs", () => {
  it("claims a job, counts the attempt and sets a lease", async () => {
    await enqueueInbound(db, "biz-1", "lead-1");
    const [job] = await claimInboundJobs(db);
    expect(job).toMatchObject({ lead_id: "lead-1", attempts: 1, status: "running" });
    const lease = new Date(String(jobs(db)[0].locked_until)).getTime() - Date.now();
    expect(lease).toBeGreaterThan((LEASE_SECONDS - 5) * 1000);
  });

  it("never gives out a second job for a chat that already has one running", async () => {
    await enqueueInbound(db, "biz-1", "lead-1");
    await claimInboundJobs(db);
    await enqueueInbound(db, "biz-1", "lead-1");
    expect(await claimInboundJobs(db)).toHaveLength(0);
  });

  it("does not claim a job that is waiting for its retry time", async () => {
    await enqueueInbound(db, "biz-1", "lead-1");
    jobs(db)[0].run_after = new Date(Date.now() + 60_000).toISOString();
    expect(await claimInboundJobs(db)).toHaveLength(0);
  });

  it("takes back a job whose worker died, and counts it as another attempt", async () => {
    await enqueueInbound(db, "biz-1", "lead-1");
    await claimInboundJobs(db);
    jobs(db)[0].locked_until = new Date(Date.now() - 1000).toISOString();
    const [again] = await claimInboundJobs(db);
    expect(again).toMatchObject({ lead_id: "lead-1", attempts: 2 });
  });

  it("drops a dead job when a newer one is already waiting for the same chat", async () => {
    await enqueueInbound(db, "biz-1", "lead-1");
    await claimInboundJobs(db);
    await enqueueInbound(db, "biz-1", "lead-1");
    jobs(db).find((j) => j.status === "running")!.locked_until = new Date(Date.now() - 1000).toISOString();
    const claimed = await claimInboundJobs(db);
    expect(claimed).toHaveLength(1);
    expect(jobs(db).map((j) => j.status).sort()).toEqual(["running", "superseded"]);
  });

  it("gives up on a dead job after the last attempt and flags the chat for the owner", async () => {
    await enqueueInbound(db, "biz-1", "lead-1");
    await claimInboundJobs(db);
    Object.assign(jobs(db)[0], { attempts: MAX_ATTEMPTS, locked_until: new Date(Date.now() - 1000).toISOString() });
    expect(await claimInboundJobs(db)).toHaveLength(0);
    expect(jobs(db)[0].status).toBe("failed");
    expect(db._db.leads[0]).toMatchObject({ pending_decision: true, human_reason: "unsure" });
  });
});

describe("failJob", () => {
  async function claimed() {
    await enqueueInbound(db, "biz-1", "lead-1");
    const [job] = await claimInboundJobs(db);
    return job;
  }

  it("puts the job back with a delay that grows with each attempt", async () => {
    const job = await claimed();
    const now = Date.now();
    expect(await failJob(db, job, new Error("AI down"), () => now)).toBe("retry");
    expect(jobs(db)[0]).toMatchObject({ status: "queued", last_error: "AI down" });
    expect(new Date(String(jobs(db)[0].run_after)).getTime() - now).toBe(30_000);

    const second = (await (async () => {
      jobs(db)[0].run_after = new Date(now - 1).toISOString();
      return (await claimInboundJobs(db))[0];
    })())!;
    await failJob(db, second, new Error("again"), () => now);
    expect(new Date(String(jobs(db)[0].run_after)).getTime() - now).toBe(120_000);
  });

  it("fails for good after the last attempt, and the owner is told", async () => {
    const job = await claimed();
    expect(await failJob(db, { ...job, attempts: MAX_ATTEMPTS }, new Error("still down"))).toBe("failed");
    expect(jobs(db)[0].status).toBe("failed");
    expect(db._db.leads[0]).toMatchObject({ pending_decision: true, human_reason: "unsure" });
    expect(String(db._db.leads[0].handoff_note)).toMatch(/could not process/i);
  });

  it("supersedes a failed job when a newer message already queued another one", async () => {
    const job = await claimed();
    await enqueueInbound(db, "biz-1", "lead-1");
    expect(await failJob(db, job, new Error("x"))).toBe("retry");
    expect(jobs(db).map((j) => j.status).sort()).toEqual(["queued", "superseded"]);
  });
});

describe("drainInboundJobs", () => {
  it("runs every due job and marks it done", async () => {
    await enqueueInbound(db, "biz-1", "lead-1");
    await enqueueInbound(db, "biz-1", "lead-2");
    const handler = vi.fn(async () => {});
    expect(await drainInboundJobs(db, handler)).toEqual({ done: 2, retried: 0, failed: 0 });
    expect(handler).toHaveBeenCalledTimes(2);
    expect(jobs(db).every((j) => j.status === "done")).toBe(true);
  });

  it("retries a job whose handler throws, without losing the other chat's job", async () => {
    await enqueueInbound(db, "biz-1", "lead-1");
    await enqueueInbound(db, "biz-1", "lead-2");
    const handler = vi.fn(async (job: { lead_id: string }) => {
      if (job.lead_id === "lead-1") throw new Error("boom");
    });
    const res = await drainInboundJobs(db, handler);
    expect(res).toEqual({ done: 1, retried: 1, failed: 0 });
    expect(jobs(db).find((j) => j.lead_id === "lead-1")).toMatchObject({ status: "queued", attempts: 1 });
    expect(jobs(db).find((j) => j.lead_id === "lead-2")!.status).toBe("done");
  });

  it("runs a job queued while its chat was being handled, right after the first finishes", async () => {
    await enqueueInbound(db, "biz-1", "lead-1");
    let calls = 0;
    await drainInboundJobs(db, async () => {
      calls++;
      if (calls === 1) await enqueueInbound(db, "biz-1", "lead-1"); // a new message arrives mid-reply
    });
    expect(calls).toBe(2);
  });

  it("never runs two jobs of one chat at the same time", async () => {
    await enqueueInbound(db, "biz-1", "lead-1");
    let running = 0;
    let maxRunning = 0;
    let first = true;
    await drainInboundJobs(db, async () => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      if (first) {
        first = false;
        await enqueueInbound(db, "biz-1", "lead-1");
      }
      await new Promise((r) => setTimeout(r, 5));
      running--;
    });
    expect(maxRunning).toBe(1);
  });

  it("stops starting new rounds once its time budget is used", async () => {
    await enqueueInbound(db, "biz-1", "lead-1");
    let t = 0;
    const res = await drainInboundJobs(db, async () => { t += 100; }, { budgetMs: 50, now: () => t });
    expect(res.done).toBe(1);
  });

  it("does not mark a job done if its lease was lost to another worker", async () => {
    await enqueueInbound(db, "biz-1", "lead-1");
    await drainInboundJobs(db, async () => {
      jobs(db)[0].status = "superseded"; // another worker took over meanwhile
    });
    expect(jobs(db)[0].status).toBe("superseded");
  });
});

describe("deleteFinishedJobs", () => {
  it("removes old finished jobs and keeps recent and active ones", async () => {
    const old = new Date(Date.now() - 10 * 86_400_000).toISOString();
    const recent = new Date().toISOString();
    db._db.inbound_jobs = [
      { id: "a", business_id: "biz-1", lead_id: "lead-1", status: "done", updated_at: old },
      { id: "b", business_id: "biz-1", lead_id: "lead-1", status: "done", updated_at: recent },
      { id: "c", business_id: "biz-1", lead_id: "lead-2", status: "queued", updated_at: old },
    ];
    await deleteFinishedJobs(db, 7);
    expect(jobs(db).map((j) => j.id).sort()).toEqual(["b", "c"]);
  });
});

describe("alerting when a job gives up", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.ALERT_WEBHOOK_URL;
    resetAlertCooldowns();
  });

  it("sends one alert when a job fails for good, and none for a job that will be retried", async () => {
    process.env.ALERT_WEBHOOK_URL = "https://alerts.example/hook";
    resetAlertCooldowns();
    const f = vi.fn(async () => new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", f);

    await enqueueInbound(db, "biz-1", "lead-1");
    const [job] = await claimInboundJobs(db);
    await failJob(db, job, new Error("AI down")); // attempt 1 of 5: retry, no alert
    expect(f).not.toHaveBeenCalled();

    await failJob(db, { ...job, attempts: MAX_ATTEMPTS }, new Error("AI still down"));
    expect(f).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(((f.mock.calls[0] as unknown) as [string, RequestInit])[1].body));
    expect(body.text).toContain("could not be processed");
  });

  it("a broken alert endpoint never breaks the job bookkeeping", async () => {
    process.env.ALERT_WEBHOOK_URL = "https://alerts.example/hook";
    resetAlertCooldowns();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network"); }));
    await enqueueInbound(db, "biz-1", "lead-1");
    const [job] = await claimInboundJobs(db);
    await expect(failJob(db, { ...job, attempts: MAX_ATTEMPTS }, new Error("x"))).resolves.toBe("failed");
    expect(jobs(db)[0].status).toBe("failed");
  });
});
