import { redirect } from "next/navigation";
import { KnowledgeView } from "@/components/knowledge/knowledge-view";
import { createClient } from "@/lib/supabase/server";
import type { KbEntry } from "@/lib/knowledge";

export default async function KnowledgePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: business } = await supabase
    .from("businesses")
    .select("id, business_facts")
    .eq("owner_id", user.id)
    .maybeSingle();
  if (!business) redirect("/dashboard");

  const { data: rows } = await supabase
    .from("knowledge_entries")
    .select("id, category, title, content")
    .eq("business_id", business.id)
    .order("created_at", { ascending: true });

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 p-4 sm:p-6">
      <header>
        <h1 className="font-heading text-3xl font-bold">Knowledge base</h1>
        <p className="mt-1 max-w-2xl text-muted-foreground">
          Everything the assistant is allowed to tell customers: menu, prices, location, hours and common
          questions. Anything not here, it hands to you instead of guessing.
        </p>
      </header>
      <KnowledgeView entries={(rows ?? []) as KbEntry[]} otherNotes={business.business_facts ?? ""} />
    </div>
  );
}
