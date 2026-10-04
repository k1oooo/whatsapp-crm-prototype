"use server";

import { revalidatePath } from "next/cache";
import type { FormState } from "@/app/dashboard/actions/shared";
import { extractText, getDocumentProxy } from "unpdf";
import {
  cleanPdfText,
  clipText,
  compileFacts,
  KB_CATEGORIES,
  MAX_DOC_CHARS,
  MAX_DOCS,
  MAX_ENTRIES,
  MAX_ENTRY_CONTENT,
  MAX_ENTRY_TITLE,
  MAX_NOTES_CHARS,
  MAX_PDF_BYTES,
  MAX_PRICE_MYR,
  type KbCategory,
  type KbEntry,
} from "@/lib/knowledge";
import { parsePrice } from "@/lib/order";
import { createClient } from "@/lib/supabase/server";

type Db = Awaited<ReturnType<typeof createClient>>;

async function myBusinessId(supabase: Db): Promise<string | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase.from("businesses").select("id").eq("owner_id", user.id).maybeSingle();
  return data?.id ?? null;
}

type EntryInput = { category: KbCategory; title: string; content: string; price_myr: number | null };

function readEntry(formData: FormData): EntryInput | string {
  const category = String(formData.get("category") ?? "");
  if (!KB_CATEGORIES.includes(category as KbCategory)) return "Pick a section.";

  const title = String(formData.get("title") ?? "").trim();
  const content = String(formData.get("content") ?? "").trim();
  const isFaq = category === "faq";

  if (!title) return isFaq ? "Type the question customers ask." : "Give it a short name.";
  if (!content) return isFaq ? "Type the answer." : "Add the details.";
  if (title.length > MAX_ENTRY_TITLE) return `Keep the ${isFaq ? "question" : "name"} under ${MAX_ENTRY_TITLE} characters.`;
  if (content.length > MAX_ENTRY_CONTENT) {
    return `Keep the ${isFaq ? "answer" : "details"} under ${MAX_ENTRY_CONTENT} characters. Split it into two entries if you need more.`;
  }

  // Only things that are sold have a price. A question never does.
  const price = isFaq ? null : parsePrice(String(formData.get("price") ?? ""));
  if (price === "invalid") return `Type the price as a number, such as 3 or 3.50 (up to ${MAX_PRICE_MYR}).`;

  return { category: category as KbCategory, title, content, price_myr: price };
}

export async function createKnowledgeEntry(_prev: FormState, formData: FormData): Promise<FormState> {
  void _prev;
  const supabase = await createClient();
  const businessId = await myBusinessId(supabase);
  if (!businessId) return { error: "Please sign in again." };

  const entry = readEntry(formData);
  if (typeof entry === "string") return { error: entry };

  const { count } = await supabase
    .from("knowledge_entries")
    .select("id", { count: "exact", head: true })
    .eq("business_id", businessId);
  if ((count ?? 0) >= MAX_ENTRIES) {
    return { error: `You have reached ${MAX_ENTRIES} entries. Delete or combine some before adding more.` };
  }

  // price_myr exists from migration 0015, so leave it out of the row when there is no price.
  const { price_myr, ...rest } = entry;
  const { error } = await supabase
    .from("knowledge_entries")
    .insert({ business_id: businessId, ...rest, ...(price_myr != null ? { price_myr } : {}) });
  if (error) return { error: "Could not save. Are migrations 0008 and 0015 applied?" };

  revalidatePath("/dashboard/knowledge");
  return { ok: true };
}

export async function updateKnowledgeEntry(id: string, _prev: FormState, formData: FormData): Promise<FormState> {
  void _prev;
  const supabase = await createClient();

  const entry = readEntry(formData);
  if (typeof entry === "string") return { error: entry };

  const { error } = await supabase
    .from("knowledge_entries")
    .update({ ...entry, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return { error: "Could not save. Try again." };

  revalidatePath("/dashboard/knowledge");
  return { ok: true };
}

export async function deleteKnowledgeEntry(id: string): Promise<FormState> {
  const supabase = await createClient();
  const { error } = await supabase.from("knowledge_entries").delete().eq("id", id);
  if (error) return { error: "Could not delete. Try again." };

  revalidatePath("/dashboard/knowledge");
  return { ok: true };
}

export async function saveOtherNotes(_prev: FormState, formData: FormData): Promise<FormState> {
  void _prev;
  const supabase = await createClient();
  const businessId = await myBusinessId(supabase);
  if (!businessId) return { error: "Please sign in again." };

  const notes = String(formData.get("business_facts") ?? "").trim() || null;
  if (notes && notes.length > MAX_NOTES_CHARS) {
    return { error: `Keep the notes under ${MAX_NOTES_CHARS} characters. Move details into entries instead.` };
  }
  const { error } = await supabase.from("businesses").update({ business_facts: notes }).eq("id", businessId);
  if (error) return { error: "Could not save. Try again." };

  revalidatePath("/dashboard/knowledge");
  return { ok: true };
}

const STARTER: { category: KbCategory; title: string; content: string; price_myr?: number }[] = [
  { category: "menu", title: "Cupcakes", content: "Chocolate, vanilla, red velvet. RM3 each. Minimum order 12.", price_myr: 3 },
  { category: "menu", title: "Birthday cake, 1 tier (serves 10)", content: "RM120. Chocolate, vanilla or red velvet.", price_myr: 120 },
  { category: "menu", title: "Birthday cake, 2 tier (serves 20)", content: "RM220. Same flavours as the 1 tier.", price_myr: 220 },
  { category: "hours", title: "Opening hours", content: "Monday to Saturday, 9am to 6pm. Closed on Sunday." },
  { category: "hours", title: "How much notice we need", content: "Cupcakes: at least 1 day. Cakes: at least 3 days." },
  { category: "location", title: "Pickup", content: "Wangsa Maju, Kuala Lumpur. Exact address sent after the order is confirmed." },
  { category: "location", title: "Delivery", content: "Shah Alam and Petaling Jaya only, RM10. Between 10am and 5pm.", price_myr: 10 },
  { category: "policy", title: "Payment", content: "Full payment before pickup or delivery, by bank transfer. Every order is confirmed by the owner." },
  { category: "policy", title: "Cancellations", content: "Free to cancel or change up to 24 hours before pickup or delivery." },
  {
    category: "faq",
    title: "Do you do custom designs?",
    content: "Simple writing on a cake is free. For a custom design or character cake, check with the owner.",
  },
];

/** Adds a starter set of entries. Only for a brand new knowledge base, so nothing existing is touched. */
export async function loadStarterKnowledge(): Promise<FormState> {
  const supabase = await createClient();
  const businessId = await myBusinessId(supabase);
  if (!businessId) return { error: "Please sign in again." };

  const { count } = await supabase
    .from("knowledge_entries")
    .select("id", { count: "exact", head: true })
    .eq("business_id", businessId);
  if (count) return { error: "You already have entries, so the example was not added." };

  let { error } = await supabase
    .from("knowledge_entries")
    .insert(STARTER.map((e) => ({ business_id: businessId, ...e })));
  if (error) {
    // No price column yet (migration 0015 not applied): add the example without prices.
    ({ error } = await supabase
      .from("knowledge_entries")
      .insert(STARTER.map(({ price_myr, ...e }) => (void price_myr, { business_id: businessId, ...e }))));
  }
  if (error) return { error: "Could not add the example. Is migration 0008 applied?" };

  revalidatePath("/dashboard/knowledge");
  return { ok: true, notice: "Added. Edit anything so it matches your business, then delete what you don't need." };
}

/** A live preview of the text the assistant currently reads. */
export async function previewFacts(): Promise<{ text: string } | { error: string }> {
  const supabase = await createClient();
  const businessId = await myBusinessId(supabase);
  if (!businessId) return { error: "Please sign in again." };

  const [{ data: rows, error }, { data: biz }, { data: docs }] = await Promise.all([
    supabase
      .from("knowledge_entries")
      .select("id, category, title, content")
      .eq("business_id", businessId)
      .order("created_at", { ascending: true }),
    supabase.from("businesses").select("business_facts").eq("id", businessId).maybeSingle(),
    supabase
      .from("knowledge_documents")
      .select("file_name, content")
      .eq("business_id", businessId)
      .order("created_at", { ascending: true }),
  ]);
  if (error) return { error: "Is migration 0008 applied?" };

  return { text: compileFacts((rows ?? []) as KbEntry[], biz?.business_facts ?? null, docs ?? []) };
}

/** Pull the text out of a PDF. Returns an error message (a string) when it can't be used. */
async function readPdf(file: File): Promise<{ text: string; pages: number } | string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  // Check the real file header, not just the name or the browser's idea of the type.
  const isPdf = bytes.length > 4 && String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3], bytes[4]) === "%PDF-";
  if (!isPdf) return "That file is not a PDF.";

  try {
    const pdf = await getDocumentProxy(bytes);
    const { totalPages, text } = await extractText(pdf, { mergePages: true });
    const clean = cleanPdfText(text);
    if (!clean) {
      return "No text found in this PDF. It may be a scan or a photo. Export it as a text PDF, or type the details in.";
    }
    return { text: clean, pages: totalPages };
  } catch {
    return "Could not read this PDF. It may be damaged or password protected.";
  }
}

/** Upload a PDF of business data (price list, menu, catalogue). Only its text is kept. */
export async function uploadKnowledgeDocument(_prev: FormState, formData: FormData): Promise<FormState> {
  void _prev;
  const supabase = await createClient();
  const businessId = await myBusinessId(supabase);
  if (!businessId) return { error: "Please sign in again." };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a PDF first." };
  if (file.size > MAX_PDF_BYTES) return { error: "That PDF is too big. The limit is 4MB." };

  const { count, error: countError } = await supabase
    .from("knowledge_documents")
    .select("id", { count: "exact", head: true })
    .eq("business_id", businessId);
  if (countError) return { error: "Could not save. Is migration 0013 applied?" };
  if ((count ?? 0) >= MAX_DOCS) {
    return { error: `You can keep up to ${MAX_DOCS} PDFs. Delete one to add another.` };
  }

  const parsed = await readPdf(file);
  if (typeof parsed === "string") return { error: parsed };

  const { text, truncated } = clipText(parsed.text, MAX_DOC_CHARS);
  const { error } = await supabase.from("knowledge_documents").insert({
    business_id: businessId,
    file_name: file.name.slice(0, 200) || "document.pdf",
    size_bytes: file.size,
    page_count: parsed.pages,
    content: text,
    truncated,
  });
  if (error) return { error: "Could not save. Try again." };

  revalidatePath("/dashboard/knowledge");
  return {
    ok: true,
    notice: truncated
      ? "Added, but it was long, so the assistant only reads the first part. Use Preview to check."
      : "Added. Use Preview to see what the assistant reads.",
  };
}

export async function deleteKnowledgeDocument(id: string): Promise<FormState> {
  const supabase = await createClient();
  const { error } = await supabase.from("knowledge_documents").delete().eq("id", id);
  if (error) return { error: "Could not delete. Try again." };

  revalidatePath("/dashboard/knowledge");
  return { ok: true };
}

