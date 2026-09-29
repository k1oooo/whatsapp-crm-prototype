import { describe, expect, it } from "vitest";
import { cardExpiresSoon, cardExpiry, cardLabel, formatMoney } from "@/lib/billing-details";

describe("billing details helpers", () => {
  it("labels cards, with a sensible fallback for unknown brands", () => {
    expect(cardLabel({ brand: "visa", last4: "4242" })).toBe("Visa ending 4242");
    expect(cardLabel({ brand: "eftpos_au", last4: "0001" })).toBe("Eftpos_au ending 0001");
  });

  it("formats expiry as MM/YY", () => {
    expect(cardExpiry({ expMonth: 8, expYear: 2027 })).toBe("08/27");
  });

  it("warns when a card is expired or about to expire", () => {
    const now = new Date("2026-09-28");
    expect(cardExpiresSoon({ expMonth: 8, expYear: 2026 }, now)).toBe(true);
    expect(cardExpiresSoon({ expMonth: 10, expYear: 2026 }, now)).toBe(true);
    expect(cardExpiresSoon({ expMonth: 12, expYear: 2026 }, now)).toBe(false);
  });

  it("drops .00 from whole amounts", () => {
    expect(formatMoney(4900, "myr")).toBe("RM 49");
    expect(formatMoney(4990, "myr")).toBe("RM 49.90");
  });
});
