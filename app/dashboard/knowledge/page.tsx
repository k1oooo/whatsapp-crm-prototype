import { redirect } from "next/navigation";
import { KnowledgeView } from "@/components/knowledge/knowledge-view";
import { createClient } from "@/lib/supabase/server";
import { getOrCreateBusiness } from "@/lib/business";
import type { KbEntry } from "@/lib/knowledge";

export default async function KnowledgePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const business = await getOrCreateBusiness<{ id: string; business_facts: string | null }>(
    supabase,
    user,
    "id, business_facts",
  );
  if (!business) redirect("/dashboard");

  const { data: rows } = await supabase
    .from("knowledge_entries")
    .select("id, category, title, content")
    .eq("business_id", business.id)
    .order("created_at", { ascending: true });

  return (
    // Every other dashboard page (follow-ups, billing, settings) scrolls inside its own
    // `overflow-y-auto` wrapper, because the shared <main> in the dashboard layout doesn't scroll
    // itself. This page was missing that wrapper, so once its content (or a tab's content) grew
    // taller than the viewport, the rest of it was simply clipped and unreachable — no scrollbar,
    // no way to get to it. `scroll-stable` reserves the scrollbar's width whether or not it's
    // currently needed, so switching between a short tab and a tall one doesn't shift the layout.
    <div className="flex-1 min-h-0 w-full overflow-y-auto overflow-x-hidden scroll-stable">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4 pb-24 sm:gap-6 sm:p-6 md:pb-6">
        <header>
          <h1 className="font-heading text-2xl font-bold md:text-3xl">Knowledge base</h1>
          <p className="mt-1 max-w-2xl text-muted-foreground">
            Everything the assistant is allowed to tell customers: menu, prices, location, hours and common
            questions. Anything not here, it hands to you instead of guessing.
          </p>
        </header>
        <KnowledgeView entries={(rows ?? []) as KbEntry[]} otherNotes={business.business_facts ?? ""} />
      </div>
    </div>
  );
}
