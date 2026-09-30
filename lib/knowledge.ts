// The knowledge base: structured facts the assistant is allowed to answer from.
import type { SupabaseClient } from "@supabase/supabase-js";

export const KB_CATEGORIES = ["menu", "location", "hours", "policy", "faq", "other"] as const;
export type KbCategory = (typeof KB_CATEGORIES)[number];

export const KB_CATEGORY_LABEL: Record<KbCategory, string> = {
  menu: "Menu and pricing",
  location: "Location and delivery",
  hours: "Hours and lead time",
  policy: "Policies",
  faq: "Frequently asked questions",
  other: "Other",
};

export const KB_CATEGORY_HINT: Record<KbCategory, string> = {
  menu: "Products, prices, minimum order.",
  location: "Pickup address, delivery areas and fees.",
  hours: "Opening days and hours, how much notice you need.",
  policy: "Payment, cancellations, refunds, custom orders.",
  faq: "One entry per question a customer often asks.",
  other: "Anything that doesn't fit above.",
};

export interface KbEntry {
  id: string;
  category: KbCategory;
  title: string;
  content: string;
}

/** An uploaded PDF, as the assistant reads it: just the extracted text. */
export interface KbDocument {
  id: string;
  file_name: string;
  size_bytes: number;
  page_count: number;
  content: string;
  truncated: boolean;
}

// The compiled facts go into every AI prompt, and the free model has a small context window. So
// each PDF is cut to a limit, and all PDFs together are cut to a bigger one.
export const MAX_PDF_BYTES = 4 * 1024 * 1024 - 64 * 1024; // leaves room for multipart overhead
export const MAX_DOC_CHARS = 20_000;
export const MAX_TOTAL_DOC_CHARS = 40_000;
export const MAX_DOCS = 5;

/** Tidy raw PDF text: normalise line endings, drop control characters, squash blank-line runs. */
export function cleanPdfText(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Cut text to a limit, at a line break where possible. */
export function clipText(text: string, max: number): { text: string; truncated: boolean } {
  if (text.length <= max) return { text, truncated: false };
  const cut = text.slice(0, max);
  const lastBreak = cut.lastIndexOf("\n");
  return { text: (lastBreak > max * 0.8 ? cut.slice(0, lastBreak) : cut).trimEnd(), truncated: true };
}

const isCategory = (v: unknown): v is KbCategory => KB_CATEGORIES.includes(v as KbCategory);

/** Turn the structured entries, plus any freeform notes, into the one text block the assistant reads. */
export function compileFacts(
  entries: KbEntry[],
  extraNotes: string | null,
  documents: Pick<KbDocument, "file_name" | "content">[] = [],
): string {
  const parts: string[] = [];
  for (const category of KB_CATEGORIES) {
    const items = entries.filter((e) => e.category === category);
    if (items.length === 0) continue;
    parts.push(KB_CATEGORY_LABEL[category].toUpperCase());
    for (const item of items) {
      parts.push(category === "faq" ? `Q: ${item.title}\nA: ${item.content}` : `${item.title}: ${item.content}`);
    }
  }
  if (extraNotes?.trim()) {
    parts.push("OTHER NOTES");
    parts.push(extraNotes.trim());
  }
  // Oldest first, and the total is capped so a pile of PDFs can't crowd out the typed entries.
  let budget = MAX_TOTAL_DOC_CHARS;
  for (const doc of documents) {
    if (budget <= 0) break;
    const body = doc.content.trim();
    if (!body) continue;
    const { text } = clipText(body, budget);
    budget -= text.length;
    parts.push(`DOCUMENT: ${doc.file_name}`);
    parts.push(text);
  }
  return parts.join("\n\n");
}

/** Read a business's knowledge base and compile it, for the assistant to use right now. */
export async function getBusinessFacts(db: SupabaseClient, businessId: string): Promise<string> {
  const [{ data: rows, error }, { data: biz }, { data: docs, error: docsError }] = await Promise.all([
    db
      .from("knowledge_entries")
      .select("id, category, title, content")
      .eq("business_id", businessId)
      .order("created_at", { ascending: true }),
    db.from("businesses").select("business_facts").eq("id", businessId).maybeSingle(),
    db
      .from("knowledge_documents")
      .select("file_name, content")
      .eq("business_id", businessId)
      .order("created_at", { ascending: true }),
  ]);

  // Uploaded PDFs are optional: if migration 0013 isn't applied yet, carry on without them.
  if (docsError) console.error("Could not read uploaded documents (is migration 0013 applied?)", docsError.message);

  if (error) {
    console.error("Could not read the knowledge base (is migration 0008 applied?)", error.message);
    // Fall back to the old single text box, so the assistant still has something to work from.
    return (biz?.business_facts as string | null) ?? "";
  }

  const entries = (rows ?? []).filter((r): r is KbEntry => isCategory(r.category));
  return compileFacts(entries, (biz?.business_facts as string | null) ?? null, docsError ? [] : (docs ?? []));
}
