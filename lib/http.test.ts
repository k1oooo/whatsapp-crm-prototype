import { afterEach, describe, expect, it, vi } from "vitest";
import { backoffMs, fetchWithRetry, retryOnlyRateLimit } from "@/lib/http";

const res = (status: number, headers: Record<string, string> = {}) => new Response("{}", { status, headers });
const noSleep = vi.fn(async () => {});
const opts = { sleep: noSleep, random: () => 1, baseDelayMs: 100 };

afterEach(() => {
  vi.unstubAllGlobals();
  noSleep.mockClear();
});

describe("fetchWithRetry", () => {
  it("returns a good answer straight away", async () => {
    const f = vi.fn(async () => res(200));
    vi.stubGlobal("fetch", f);
    expect((await fetchWithRetry("https://x", {}, opts)).status).toBe(200);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("retries a 503 and then succeeds", async () => {
    const f = vi.fn().mockResolvedValueOnce(res(503)).mockResolvedValueOnce(res(200));
    vi.stubGlobal("fetch", f);
    expect((await fetchWithRetry("https://x", {}, opts)).status).toBe(200);
    expect(f).toHaveBeenCalledTimes(2);
    expect(noSleep).toHaveBeenCalledTimes(1);
  });

  it("does not retry a 400", async () => {
    const f = vi.fn(async () => res(400));
    vi.stubGlobal("fetch", f);
    expect((await fetchWithRetry("https://x", {}, opts)).status).toBe(400);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("gives up after the retries and returns the last answer", async () => {
    const f = vi.fn(async () => res(500));
    vi.stubGlobal("fetch", f);
    expect((await fetchWithRetry("https://x", {}, { ...opts, retries: 2 })).status).toBe(500);
    expect(f).toHaveBeenCalledTimes(3);
  });

  it("retries a network error and throws the last one when it keeps failing", async () => {
    const f = vi.fn(async () => {
      throw new Error("reset");
    });
    vi.stubGlobal("fetch", f);
    await expect(fetchWithRetry("https://x", {}, { ...opts, retries: 1 })).rejects.toThrow("reset");
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("puts a timeout signal on every attempt", async () => {
    const f = vi.fn(async (_u: string, init?: RequestInit) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return res(200);
    });
    vi.stubGlobal("fetch", f);
    await fetchWithRetry("https://x", {}, opts);
    expect(f).toHaveBeenCalled();
  });

  it("honours Retry-After, capped at 4 seconds", async () => {
    const f = vi.fn().mockResolvedValueOnce(res(429, { "retry-after": "60" })).mockResolvedValueOnce(res(200));
    vi.stubGlobal("fetch", f);
    await fetchWithRetry("https://x", {}, opts);
    expect(noSleep).toHaveBeenCalledWith(4000);
  });

  it("for a send, retries only a 429 and never a 5xx or a network error", async () => {
    const f5 = vi.fn(async () => res(500));
    vi.stubGlobal("fetch", f5);
    expect((await fetchWithRetry("https://x", {}, { ...opts, shouldRetry: retryOnlyRateLimit })).status).toBe(500);
    expect(f5).toHaveBeenCalledTimes(1);

    const fe = vi.fn(async () => {
      throw new Error("timeout");
    });
    vi.stubGlobal("fetch", fe);
    await expect(fetchWithRetry("https://x", {}, { ...opts, shouldRetry: retryOnlyRateLimit })).rejects.toThrow();
    expect(fe).toHaveBeenCalledTimes(1);

    const f429 = vi.fn().mockResolvedValueOnce(res(429)).mockResolvedValueOnce(res(200));
    vi.stubGlobal("fetch", f429);
    expect((await fetchWithRetry("https://x", {}, { ...opts, shouldRetry: retryOnlyRateLimit })).status).toBe(200);
  });
});

describe("backoffMs", () => {
  it("grows with each attempt, stays under the ceiling, and is jittered", () => {
    expect(backoffMs(0, 400, () => 1)).toBe(400);
    expect(backoffMs(1, 400, () => 1)).toBe(800);
    expect(backoffMs(10, 400, () => 1)).toBe(4000);
    expect(backoffMs(2, 400, () => 0)).toBe(0);
  });
});
