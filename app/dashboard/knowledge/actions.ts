"use server";

import { revalidatePath } from "next/cache";
import type { FormState } from "@/app/dashboard/actions";
import { compileFacts, KB_CATEGORIES, type KbCategory, type KbEntry } from "@/lib/knowledge";
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

  const [{ data: rows, error }, { data: biz }] = await Promise.all([
    supabase
      .from("knowledge_entries")
      .select("id, category, title, content")
      .eq("business_id", businessId)
      .order("created_at", { ascending: true }),
    supabase.from("businesses").select("business_facts").eq("id", businessId).maybeSingle(),
  ]);
  if (error) return { error: "Is migration 0008 applied?" };

  return { text: compileFacts((rows ?? []) as KbEntry[], biz?.business_facts ?? null) };
}
