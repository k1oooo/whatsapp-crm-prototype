import { describe, expect, it } from "vitest";
import { formatChangePct, formatDuration } from "@/lib/dashboard-data";

describe("dashboard data formatters", () => {
  it("formats reply time in seconds under 90s, minutes above", () => {
    expect(formatDuration(12)).toBe("12 sec");
    expect(formatDuration(89)).toBe("89 sec");
    expect(formatDuration(90)).toBe("2 min");
    expect(formatDuration(185)).toBe("3 min");
  });

  it("formats a signed percentage, or null when there's no prior period", () => {
    expect(formatChangePct(18.4)).toBe("+18%");
    expect(formatChangePct(-4.2)).toBe("-4%");
    expect(formatChangePct(0)).toBe("0%");
    expect(formatChangePct(null)).toBeNull();
  });
});
