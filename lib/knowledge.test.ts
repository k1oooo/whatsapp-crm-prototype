import { describe, expect, it } from "vitest";
import { cleanPdfText, clipText, compileFacts, MAX_TOTAL_DOC_CHARS, type KbEntry } from "@/lib/knowledge";

const entry: KbEntry = { id: "1", category: "menu", title: "Cupcakes", content: "RM3 each." };

describe("compileFacts with uploaded PDFs", () => {
  it("is unchanged when there are no documents", () => {
    expect(compileFacts([entry], null)).toBe("MENU AND PRICING\n\nCupcakes: RM3 each.");
  });

  it("appends each PDF under its file name, after the typed entries and notes", () => {
    const text = compileFacts([entry], "Closed on public holidays.", [
      { file_name: "prices.pdf", content: "Brownies RM5" },
    ]);
    expect(text.indexOf("OTHER NOTES")).toBeLessThan(text.indexOf("DOCUMENT: prices.pdf"));
    expect(text.endsWith("DOCUMENT: prices.pdf\n\nBrownies RM5")).toBe(true);
  });

  it("works with only documents and no typed entries", () => {
    expect(compileFacts([], null, [{ file_name: "menu.pdf", content: "Nasi lemak RM6" }])).toBe(
      "DOCUMENT: menu.pdf\n\nNasi lemak RM6",
    );
  });

  it("skips blank documents", () => {
    expect(compileFacts([entry], null, [{ file_name: "empty.pdf", content: "   " }])).not.toContain("DOCUMENT");
  });

  it("caps the total size of all documents so they can't crowd out the prompt", () => {
    const big = "x".repeat(MAX_TOTAL_DOC_CHARS);
    const text = compileFacts([], null, [
      { file_name: "a.pdf", content: big },
      { file_name: "b.pdf", content: "second file" },
    ]);
    expect(text).toContain("DOCUMENT: a.pdf");
    expect(text).not.toContain("DOCUMENT: b.pdf");
  });
});

describe("cleanPdfText", () => {
  it("normalises line endings, strips control characters and collapses blank runs", () => {
    expect(cleanPdfText("a\r\nb\u0000\n\n\n\nc  \n")).toBe("a\nb\n\nc");
  });
});

describe("clipText", () => {
  it("leaves short text alone", () => {
    expect(clipText("short", 100)).toEqual({ text: "short", truncated: false });
  });

  it("cuts long text at a line break near the limit and says it was cut", () => {
    const text = `${"a".repeat(90)}\n${"b".repeat(50)}`;
    expect(clipText(text, 100)).toEqual({ text: "a".repeat(90), truncated: true });
  });
});
