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
