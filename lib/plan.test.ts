import { describe, expect, it } from "vitest";
import { formatPlanPrice } from "@/lib/plan";

describe("formatPlanPrice", () => {
  it("drops .00 on whole amounts", () => {
    expect(formatPlanPrice(4900, "myr", "month")).toEqual({ amount: "RM 49", interval: "month" });
  });
  it("keeps cents when there are some", () => {
    expect(formatPlanPrice(4990, "myr", "month").amount).toBe("RM 49.90");
  });
  it("handles another currency and interval", () => {
    const p = formatPlanPrice(1500, "usd", "year");
    expect(p.interval).toBe("year");
    expect(p.amount).toMatch(/15/);
  });
});
