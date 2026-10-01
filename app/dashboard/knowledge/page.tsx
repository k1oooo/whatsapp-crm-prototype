import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeader, PageShell } from "@/components/app/page-shell";
import { KnowledgeView } from "@/components/knowledge/knowledge-view";
import { createClient } from "@/lib/supabase/server";
import { getOrCreateBusiness } from "@/lib/business";
import type { KbEntry } from "@/lib/knowledge";
import type { DocSummary } from "@/components/knowledge/documents-panel";

export const metadata: Metadata = { title: "Knowledge base" };

export default async function KnowledgePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; a?: string }>;
}) {
  // Arriving from a chat with "Save to Knowledge base": open the new-question form filled in.
  const { q, a } = await searchParams;
  const prefill = q || a ? { title: (q ?? "").slice(0, 200), content: (a ?? "").slice(0, 2000) } : null;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const business = await getOrCreateBusiness<{
    id: string;
    business_facts: string | null;
  }>(supabase, user, "id, business_facts");
  if (!business) redirect("/dashboard");

  const { data: rows } = await supabase
    .from("knowledge_entries")
    .select("id, category, title, content")
    .eq("business_id", business.id)
    .order("created_at", { ascending: true });

  // Only the list details, not the extracted text, which can be long. Empty if migration 0013
  // hasn't been applied yet, so the page still works.
  const { data: docRows } = await supabase
    .from("knowledge_documents")
    .select("id, file_name, size_bytes, page_count, truncated")
    .eq("business_id", business.id)
    .order("created_at", { ascending: true });

  return (
    <PageShell>
      <PageHeader
        title="Knowledge base"
        description="Everything the assistant is allowed to tell customers: menu, prices, location, hours and common questions. Anything not here, it hands to you instead of guessing."
      />
      <KnowledgeView
        entries={(rows ?? []) as KbEntry[]}
        otherNotes={business.business_facts ?? ""}
        documents={(docRows ?? []) as DocSummary[]}
        prefill={prefill}
      />
    </PageShell>
  );
}
