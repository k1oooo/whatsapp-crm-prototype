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

const isCategory = (v: unknown): v is KbCategory => KB_CATEGORIES.includes(v as KbCategory);

/** Turn the structured entries, plus any freeform notes, into the one text block the assistant reads. */
export function compileFacts(entries: KbEntry[], extraNotes: string | null): string {
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
  return parts.join("\n\n");
}

/** Read a business's knowledge base and compile it, for the assistant to use right now. */
export async function getBusinessFacts(db: SupabaseClient, businessId: string): Promise<string> {
  const [{ data: rows, error }, { data: biz }] = await Promise.all([
    db
      .from("knowledge_entries")
      .select("id, category, title, content")
      .eq("business_id", businessId)
      .order("created_at", { ascending: true }),
    db.from("businesses").select("business_facts").eq("id", businessId).maybeSingle(),
  ]);

  if (error) {
    console.error("Could not read the knowledge base (is migration 0008 applied?)", error.message);
    // Fall back to the old single text box, so the assistant still has something to work from.
    return (biz?.business_facts as string | null) ?? "";
  }

  const entries = (rows ?? []).filter((r): r is KbEntry => isCategory(r.category));
  return compileFacts(entries, (biz?.business_facts as string | null) ?? null);
}
