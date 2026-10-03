import { describe, expect, it } from "vitest";
import {
  buildCatalog,
  computeOrder,
  computedAmounts,
  fillTotal,
  formatMyr,
  hasUnverifiedAmount,
  parseStoredLines,
} from "@/lib/order";

const catalog = buildCatalog([
  { id: "e-cup", title: "Cupcakes", price_myr: 3 },
  { id: "e-faq", title: "Do you do custom designs?", price_myr: null },
  { id: "e-cake", title: "Cake, 1 tier", price_myr: 120 },
  { id: "e-del", title: "Delivery", price_myr: 10.5 },
]);

describe("buildCatalog", () => {
  it("codes only priced entries, in order", () => {
    expect(catalog.map((c) => [c.code, c.title])).toEqual([
      ["P1", "Cupcakes"],
      ["P2", "Cake, 1 tier"],
      ["P3", "Delivery"],
    ]);
  });
  it("ignores missing and negative prices", () => {
    expect(buildCatalog([{ id: "a", title: "A", price_myr: -1 }, { id: "b", title: "B" }])).toEqual([]);
  });
});

describe("computeOrder", () => {
  it("prices lines and sums the total in code", () => {
    const r = computeOrder([{ item: "P1", qty: 12 }, { item: "P3", qty: 1 }], catalog);
    expect(r).toMatchObject({ ok: true, totalMyr: 46.5 });
    if (r.ok) expect(r.lines[0]).toMatchObject({ title: "Cupcakes", qty: 12, unit_myr: 3, subtotal_myr: 36 });
  });

  it("merges the same item listed twice", () => {
    const r = computeOrder([{ item: "P1", qty: 6 }, { item: "p1", qty: 6 }], catalog);
    expect(r).toMatchObject({ ok: true, totalMyr: 36 });
  });

  it("rejects an item that is not on the menu", () => {
    expect(computeOrder([{ item: "P9", qty: 1 }], catalog).ok).toBe(false);
  });

  it.each([0, -3, 1.5, 1001, Number.NaN])("rejects quantity %s", (qty) => {
    expect(computeOrder([{ item: "P1", qty }], catalog).ok).toBe(false);
  });

  it("rejects an empty order and an absurd number of lines", () => {
    expect(computeOrder([], catalog).ok).toBe(false);
    expect(computeOrder(Array.from({ length: 21 }, () => ({ item: "P1", qty: 1 })), catalog).ok).toBe(false);
  });

  it("does not drift on prices like 0.1 + 0.2", () => {
    const c = buildCatalog([{ id: "x", title: "X", price_myr: 0.1 }, { id: "y", title: "Y", price_myr: 0.2 }]);
    const r = computeOrder([{ item: "P1", qty: 1 }, { item: "P2", qty: 1 }], c);
    expect(r).toMatchObject({ ok: true, totalMyr: 0.3 });
  });
});

describe("fillTotal and formatMyr", () => {
  it("fills the token with the computed total", () => {
    expect(fillTotal("Total {TOTAL} ya.", 46.5)).toEqual({ reply: "Total RM46.50 ya.", ok: true });
    expect(fillTotal("Total {TOTAL}", 36).reply).toBe("Total RM36");
  });
  it("reports failure instead of leaking the token when there is no total", () => {
    expect(fillTotal("Total {TOTAL}", null).ok).toBe(false);
  });
  it("leaves a reply with no token alone", () => {
    expect(fillTotal("Sama-sama!", null)).toEqual({ reply: "Sama-sama!", ok: true });
  });
  it("formats whole and fractional amounts", () => {
    expect(formatMyr(3)).toBe("RM3");
    expect(formatMyr(3.5)).toBe("RM3.50");
  });
});

describe("hasUnverifiedAmount (strict)", () => {
  const facts = "Cupcakes [P1] (RM3 each). Cake RM120. Delivery RM10.";
  const chat = "nak 12 cupcake, pickup 10am esok, 15 Okt, unit 22, jalan 7, 3 box";

  it("REGRESSION: catches the invented prices the old guard let through", () => {
    for (const amt of ["RM77", "RM95", "RM143", "RM58"]) {
      expect(hasUnverifiedAmount(`Total ${amt} ya`, facts, chat, [])).toBe(true);
    }
  });

  it("allows an amount written in the facts", () => {
    expect(hasUnverifiedAmount("Cupcake RM3 satu, delivery RM10.", facts, chat, [])).toBe(false);
  });

  it("allows an amount the customer wrote themselves", () => {
    expect(hasUnverifiedAmount("Bajet RM50 boleh ya.", facts, "bajet RM50", [])).toBe(false);
  });

  it("allows only what the server computed for the order", () => {
    const lines = computeOrder([{ item: "P1", qty: 12 }], catalog);
    if (!lines.ok) throw new Error("setup");
    const ok = computedAmounts(lines.lines, lines.totalMyr);
    expect(hasUnverifiedAmount("12 x RM3 = RM36", facts, chat, ok)).toBe(false);
    expect(hasUnverifiedAmount("Total RM37", facts, chat, ok)).toBe(true);
  });

  it("does not let a sum of known prices pass by itself", () => {
    // 3 x 12 + 10 = 46 is a sum of facts, but nobody computed it, so it is not verified.
    expect(hasUnverifiedAmount("Total RM46", facts, chat, [])).toBe(true);
  });

  it("handles decimals and thousands separators", () => {
    expect(hasUnverifiedAmount("RM1,200.50", "RM1,200.50", "", [])).toBe(false);
    expect(hasUnverifiedAmount("RM3,50", "RM3.50", "", [])).toBe(false);
    expect(hasUnverifiedAmount("RM1,200.00", "RM1,200.50", "", [])).toBe(true);
  });
});

describe("parseStoredLines", () => {
  it("keeps valid lines and drops junk", () => {
    const lines = parseStoredLines([
      { entry_id: "a", title: "A", qty: 2, unit_myr: 3 },
      { entry_id: "b", title: "B", qty: 0, unit_myr: 3 },
      "nope",
      null,
    ]);
    expect(lines).toEqual([{ entry_id: "a", title: "A", qty: 2, unit_myr: 3, subtotal_myr: 6 }]);
  });
  it("returns nothing for a non-array", () => {
    expect(parseStoredLines(null)).toEqual([]);
    expect(parseStoredLines({})).toEqual([]);
  });
});
