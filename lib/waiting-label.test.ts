import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { waitingLabel } from "@/lib/leads";

describe("waitingLabel", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-01T12:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

  it("returns null when there is no time", () => {
    expect(waitingLabel(null)).toBeNull();
  });
  it("says just now for under a minute", () => {
    expect(waitingLabel(ago(20_000))).toBe("just now");
  });
  it("uses minutes, hours and days", () => {
    expect(waitingLabel(ago(12 * 60_000))).toBe("12 min");
    expect(waitingLabel(ago(3 * 3_600_000))).toBe("3 h");
    expect(waitingLabel(ago(24 * 3_600_000))).toBe("1 day");
    expect(waitingLabel(ago(72 * 3_600_000))).toBe("3 days");
  });
  it("never goes negative when a clock is slightly ahead", () => {
    expect(waitingLabel(ago(-5_000))).toBe("just now");
  });
});
