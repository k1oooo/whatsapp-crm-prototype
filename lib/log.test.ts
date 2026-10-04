import { afterEach, describe, expect, it, vi } from "vitest";
import { alert, resetAlertCooldowns } from "@/lib/alert";
import { log } from "@/lib/log";

const lines = (spy: ReturnType<typeof vi.spyOn>) => spy.mock.calls.map((c) => JSON.parse(String(c[0])));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete process.env.LOG_LEVEL;
  delete process.env.ALERT_WEBHOOK_URL;
  resetAlertCooldowns();
});

describe("log", () => {
  it("writes one JSON object per line with the event and fields", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    log.info("lead.refreshed", { leadId: "l1" });
    const [line] = lines(spy);
    expect(line).toMatchObject({ level: "info", event: "lead.refreshed", leadId: "l1" });
    expect(new Date(line.ts).getTime()).not.toBeNaN();
  });

  it("a child logger adds its fields to every line", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const l = log.child({ leadId: "l1", jobId: "j1" });
    l.info("a");
    l.child({ attempt: 2 }).info("b");
    expect(lines(spy)).toMatchObject([{ leadId: "l1", jobId: "j1" }, { leadId: "l1", jobId: "j1", attempt: 2 }]);
  });

  it("describes an Error, and a Supabase style error object", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    log.error("x", { id: 1 }, new Error("boom"));
    log.error("y", {}, { code: "23505", message: "duplicate key" });
    const [a, b] = lines(spy);
    expect(a).toMatchObject({ level: "error", error: "boom", errorName: "Error", id: 1 });
    expect(b).toMatchObject({ error: "duplicate key", errorCode: "23505" });
  });

  it("respects LOG_LEVEL", () => {
    process.env.LOG_LEVEL = "warn";
    const info = vi.spyOn(console, "log").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    log.info("quiet");
    log.warn("loud");
    expect(info).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe("alert", () => {
  const ok = () => vi.fn(async () => new Response("ok", { status: 200 }));

  it("only logs when no webhook is configured", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const f = ok();
    vi.stubGlobal("fetch", f);
    expect(await alert("inbound_job.failed", "A job failed")).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });

  it("posts to the webhook and marks the log line as an alert", async () => {
    process.env.ALERT_WEBHOOK_URL = "https://hooks.example/x";
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const f = ok();
    vi.stubGlobal("fetch", f);
    expect(await alert("inbound_job.failed", "A job failed", { fields: { jobId: "j1" } })).toBe(true);
    expect(JSON.parse(String((f.mock.calls[0] as unknown as [string, RequestInit])[1].body)).text).toContain("A job failed");
    expect(lines(spy)[0]).toMatchObject({ event: "inbound_job.failed", alert: true, jobId: "j1" });
  });

  it("sends one message for a storm of identical alerts, then again after the cooldown", async () => {
    process.env.ALERT_WEBHOOK_URL = "https://hooks.example/x";
    vi.spyOn(console, "error").mockImplementation(() => {});
    const f = ok();
    vi.stubGlobal("fetch", f);
    let t = 1_000_000;
    for (let i = 0; i < 5; i++) await alert("e", "m", { now: () => t });
    expect(f).toHaveBeenCalledTimes(1);
    t += 11 * 60_000;
    await alert("e", "m", { now: () => t });
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("never throws when the webhook is down", async () => {
    process.env.ALERT_WEBHOOK_URL = "https://hooks.example/x";
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network"); }));
    await expect(alert("e", "m")).resolves.toBe(false);
  });
});
