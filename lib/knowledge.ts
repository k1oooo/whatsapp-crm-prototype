// The knowledge base: structured facts the assistant is allowed to answer from.
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildCatalog, formatMyr, type CatalogItem } from "@/lib/order";

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
  /** A fixed price in RM. Priced entries are what order totals are computed from. */
  price_myr?: number | null;
}

// Limits on what an owner can type. Every character of the knowledge base is sent to the AI with
// every message, so unbounded text is unbounded cost and a way to push the real rules out of context.
export const MAX_ENTRY_TITLE = 150;
export const MAX_ENTRY_CONTENT = 2_000;
export const MAX_ENTRIES = 300;
export const MAX_NOTES_CHARS = 5_000;
export const MAX_PRICE_MYR = 100_000;
/** Typed entries and notes together. PDFs have their own cap below. */
export const MAX_TYPED_FACT_CHARS = 30_000;

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
  const codeOf = new Map(buildCatalog(entries).map((c) => [c.entryId, c]));
  const parts: string[] = [];

  // Typed text is capped as a whole. Whatever does not fit is left out, never cut in half.
  let typedBudget = MAX_TYPED_FACT_CHARS;
  let dropped = 0;
  const addTyped = (text: string): boolean => {
    if (text.length > typedBudget) {
      dropped++;
      return false;
    }
    typedBudget -= text.length;
    parts.push(text);
    return true;
  };

  for (const category of KB_CATEGORIES) {
    const items = entries.filter((e) => e.category === category);
    if (items.length === 0) continue;
    addTyped(KB_CATEGORY_LABEL[category].toUpperCase());
    for (const item of items) {
      const priced = codeOf.get(item.id);
      const head = priced ? `${item.title} [${priced.code}] (${formatMyr(priced.priceMyr)} each)` : item.title;
      addTyped(category === "faq" ? `Q: ${item.title}\nA: ${item.content}` : `${head}: ${item.content}`);
    }
  }
  if (extraNotes?.trim()) {
    addTyped("OTHER NOTES");
    addTyped(extraNotes.trim());
  }
  if (dropped > 0) {
    console.warn(`Knowledge base is over ${MAX_TYPED_FACT_CHARS} characters: ${dropped} entries left out of the AI prompt`);
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

export interface Knowledge {
  /** The compiled text the assistant reads. */
  facts: string;
  /** Priced menu items, with the codes used in `facts`. */
  catalog: CatalogItem[];
}

/** Read a business's knowledge base and compile it, for the assistant to use right now. */
export async function getBusinessKnowledge(db: SupabaseClient, businessId: string): Promise<Knowledge> {
  const readEntries = (cols: string) =>
    db
      .from("knowledge_entries")
      .select(cols)
      .eq("business_id", businessId)
      .order("created_at", { ascending: true });

  const [entriesRes, { data: biz }, { data: docs, error: docsError }] = await Promise.all([
    readEntries("id, category, title, content, price_myr"),
    db.from("businesses").select("business_facts").eq("id", businessId).maybeSingle(),
    db
      .from("knowledge_documents")
      .select("file_name, content")
      .eq("business_id", businessId)
      .order("created_at", { ascending: true }),
  ]);
  let rows: unknown = entriesRes.data;
  let error = entriesRes.error;

  // Before migration 0015 there is no price column. Read the entries without it, so the assistant keeps
  // working (with no priced items) instead of falling back to the old text box.
  if (error) {
    const retry = await readEntries("id, category, title, content");
    if (!retry.error) {
      console.error("knowledge_entries has no price_myr yet (is migration 0015 applied?)");
      rows = retry.data;
      error = null;
    }
  }

  // Uploaded PDFs are optional: if migration 0013 isn't applied yet, carry on without them.
  if (docsError) console.error("Could not read uploaded documents (is migration 0013 applied?)", docsError.message);

  if (error) {
    console.error("Could not read the knowledge base (is migration 0008 applied?)", error.message);
    // Fall back to the old single text box, so the assistant still has something to work from.
    return { facts: (biz?.business_facts as string | null) ?? "", catalog: [] };
  }

  const entries = ((rows ?? []) as unknown as KbEntry[]).filter((r) => isCategory(r.category));
  return {
    facts: compileFacts(entries, (biz?.business_facts as string | null) ?? null, docsError ? [] : ((docs ?? []) as { file_name: string; content: string }[])),
    catalog: buildCatalog(entries),
  };
}

/** Just the compiled text. Kept for callers that do not need the priced items. */
export async function getBusinessFacts(db: SupabaseClient, businessId: string): Promise<string> {
  return (await getBusinessKnowledge(db, businessId)).facts;
}
