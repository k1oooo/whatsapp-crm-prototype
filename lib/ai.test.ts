import { describe, expect, it } from "vitest";
import { hasPlaceholder, mergeLead, usesUnknownAmount, type LeadFields } from "@/lib/ai";

describe("usesUnknownAmount", () => {
  const facts = "Cupcake RM3 each. Delivery RM10 flat fee. Minimum order 12.";

  it("allows a price that is stated directly in the facts", () => {
    expect(usesUnknownAmount("Cupcake harga RM3 sahaja.", facts)).toBe(false);
  });

  it("allows a price that is a simple multiplication of a fact price and a quantity in the chat", () => {
    // 12 cupcakes x RM3 = RM36
    expect(usesUnknownAmount("Jumlah RM36 untuk 12 biji.", `${facts}\n12 biji`)).toBe(false);
  });

  it("allows a price and delivery fee correctly summed", () => {
    // 12 x RM3 + RM10 delivery = RM46
    expect(usesUnknownAmount("Jumlah semua RM46 termasuk delivery.", `${facts}\n12 biji`)).toBe(false);
  });

  it("flags a price that appears nowhere in the facts or the chat (a hallucinated discount)", () => {
    expect(usesUnknownAmount("Diskaun RM7 untuk awak.", facts)).toBe(true);
  });

  it("flags an invented total that doesn't match any combination of known prices", () => {
    expect(usesUnknownAmount("Jumlah RM99.", `${facts}\n12 biji`)).toBe(true);
  });
});

describe("hasPlaceholder", () => {
  it("catches an unfinished bank details placeholder", () => {
    expect(hasPlaceholder("Please transfer to [BANK NAME], account [ACCOUNT NUMBER]")).toBe(true);
  });

  it("does not flag ordinary bracket-free text", () => {
    expect(hasPlaceholder("Please transfer to Maybank, account 1234567890")).toBe(false);
  });

  it("does not flag a lone short bracketed word that isn't a placeholder shape", () => {
    // single lowercase letter bracket shouldn't match the placeholder heuristic
    expect(hasPlaceholder("See [a] for details")).toBe(false);
  });
});

describe("mergeLead", () => {
  const existing: Partial<LeadFields> = {
    name: "Aina",
    need: "Birthday cake",
    budget_myr: 100,
    quoted_price_myr: null,
    deadline: null,
    stage: "talking",
    language: "bm",
  };

  it("keeps existing fields when the new extraction says null (a vague message can't erase known details)", () => {
    const next: LeadFields = {
      name: null,
      need: null,
      budget_myr: null,
      quoted_price_myr: 120,
      deadline: null,
      stage: "quoted",
      language: null,
    };
    const merged = mergeLead(existing, next);
    expect(merged.name).toBe("Aina");
    expect(merged.need).toBe("Birthday cake");
    expect(merged.budget_myr).toBe(100);
    expect(merged.quoted_price_myr).toBe(120);
    expect(merged.language).toBe("bm");
  });

  it("always takes the new stage, even when it goes backwards", () => {
    const next: LeadFields = {
      name: null,
      need: null,
      budget_myr: null,
      quoted_price_myr: null,
      deadline: null,
      stage: "lost",
      language: null,
    };
    expect(mergeLead(existing, next).stage).toBe("lost");
  });
});

import { agentOutputSchema, extractJson } from "@/lib/ai";

describe("extractJson", () => {
  it("reads a plain object", () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
  });
  it("reads an object wrapped in prose and code fences", () => {
    expect(extractJson('Sure!\n```json\n{"a":1,"b":{"c":2}}\n```\nHope that helps')).toEqual({ a: 1, b: { c: 2 } });
  });
  it("REGRESSION: ignores a stray closing brace after the object", () => {
    expect(extractJson('{"a":1} (note: keys look like {this})')).toEqual({ a: 1 });
  });
  it("is not fooled by braces inside strings", () => {
    expect(extractJson('{"reply":"use {TOTAL} and } here","n":2}')).toEqual({ reply: "use {TOTAL} and } here", n: 2 });
  });
  it("handles escaped quotes inside strings", () => {
    expect(extractJson('{"reply":"he said \\"hi\\" }"}')).toEqual({ reply: 'he said "hi" }' });
  });
  it("throws when there is no object or it never closes", () => {
    expect(() => extractJson("no json here")).toThrow();
    expect(() => extractJson('{"a":1')).toThrow();
  });
});

describe("agentOutputSchema", () => {
  it("accepts a well formed reply with order lines", () => {
    const r = agentOutputSchema.parse({
      action: "reply",
      reason: null,
      reply: "Total {TOTAL} ya",
      note: null,
      order: { status: "awaiting_confirmation", summary: "12 cupcakes", lines: [{ item: "P1", qty: "12" }] },
      lead: { name: "Aina" },
    });
    expect(r.order.lines).toEqual([{ item: "P1", qty: 12 }]);
    expect(r.order.status).toBe("awaiting_confirmation");
  });

  it("hands over when the action is not one it knows", () => {
    expect(agentOutputSchema.parse({ action: "send_money" }).action).toBe("escalate");
  });

  it("drops ALL order lines if any one is invalid", () => {
    const r = agentOutputSchema.parse({
      action: "reply",
      order: { status: "awaiting_confirmation", lines: [{ item: "P1", qty: 2 }, { item: "P2", qty: -5 }] },
    });
    expect(r.order.lines).toEqual([]);
  });

  it.each([0, 1.5, 100000, "lots"])("rejects quantity %s", (qty) => {
    expect(agentOutputSchema.parse({ order: { lines: [{ item: "P1", qty }] } }).order.lines).toEqual([]);
  });

  it("falls back to no order when the order is the wrong type", () => {
    const r = agentOutputSchema.parse({ action: "reply", order: "confirmed" });
    expect(r.order).toEqual({ status: "none", summary: null, lines: [] });
  });

  it("caps the reply and summary length and ignores non-string text", () => {
    const r = agentOutputSchema.parse({ reply: "x".repeat(5000), order: { summary: "y".repeat(5000) }, note: 42 });
    expect(r.reply).toHaveLength(1000);
    expect(r.order.summary).toHaveLength(500);
    expect(r.note).toBeNull();
  });

  it("refuses more order lines than an order can have", () => {
    const lines = Array.from({ length: 21 }, () => ({ item: "P1", qty: 1 }));
    expect(agentOutputSchema.parse({ order: { lines } }).order.lines).toEqual([]);
  });
});
