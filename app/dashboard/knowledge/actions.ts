"use server";

import { revalidatePath } from "next/cache";
import type { FormState } from "@/app/dashboard/actions";
import { extractText, getDocumentProxy } from "unpdf";
import {
  cleanPdfText,
  clipText,
  compileFacts,
  KB_CATEGORIES,
  MAX_DOC_CHARS,
  MAX_DOCS,
  MAX_PDF_BYTES,
  type KbCategory,
  type KbEntry,
} from "@/lib/knowledge";
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

function readEntry(formData: FormData): { category: KbCategory; title: string; content: string } | string {
  const category = String(formData.get("category") ?? "");
  if (!KB_CATEGORIES.includes(category as KbCategory)) return "Pick a section.";

  const title = String(formData.get("title") ?? "").trim();
  const content = String(formData.get("content") ?? "").trim();
  const isFaq = category === "faq";

  if (!title) return isFaq ? "Type the question customers ask." : "Give it a short name.";
  if (!content) return isFaq ? "Type the answer." : "Add the details.";

  return { category: category as KbCategory, title, content };
}

export async function createKnowledgeEntry(_prev: FormState, formData: FormData): Promise<FormState> {
  void _prev;
  const supabase = await createClient();
  const businessId = await myBusinessId(supabase);
  if (!businessId) return { error: "Please sign in again." };

  const entry = readEntry(formData);
  if (typeof entry === "string") return { error: entry };

  const { error } = await supabase.from("knowledge_entries").insert({ business_id: businessId, ...entry });
  if (error) return { error: "Could not save. Is migration 0008 applied?" };

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
  const { error } = await supabase.from("businesses").update({ business_facts: notes }).eq("id", businessId);
  if (error) return { error: "Could not save. Try again." };

  revalidatePath("/dashboard/knowledge");
  return { ok: true };
}

const STARTER: { category: KbCategory; title: string; content: string }[] = [
  { category: "menu", title: "Cupcakes", content: "Chocolate, vanilla, red velvet. RM3 each. Minimum order 12." },
  { category: "menu", title: "Birthday cake, 1 tier (serves 10)", content: "RM120. Chocolate, vanilla or red velvet." },
  { category: "menu", title: "Birthday cake, 2 tier (serves 20)", content: "RM220. Same flavours as the 1 tier." },
  { category: "hours", title: "Opening hours", content: "Monday to Saturday, 9am to 6pm. Closed on Sunday." },
  { category: "hours", title: "How much notice we need", content: "Cupcakes: at least 1 day. Cakes: at least 3 days." },
  { category: "location", title: "Pickup", content: "Wangsa Maju, Kuala Lumpur. Exact address sent after the order is confirmed." },
  { category: "location", title: "Delivery", content: "Shah Alam and Petaling Jaya only, RM10. Between 10am and 5pm." },
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

  const { error } = await supabase
    .from("knowledge_entries")
    .insert(STARTER.map((e) => ({ business_id: businessId, ...e })));
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

