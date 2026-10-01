import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/app/page-shell";
import { PipelineBoard } from "@/components/pipeline-board";
import { createClient } from "@/lib/supabase/server";
import { getOrCreateBusiness } from "@/lib/business";
import { LEAD_COLUMNS, rm, type Lead } from "@/lib/leads";

export const metadata: Metadata = { title: "Pipeline" };

export default async function PipelinePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const business = await getOrCreateBusiness<{
    id: string;
    cold_after_days: number;
  }>(supabase, user, "id, cold_after_days");
  if (!business) redirect("/dashboard");

  const { data: leadRows, error } = await supabase
    .from("leads")
    .select(LEAD_COLUMNS)
    .eq("business_id", business.id)
    .order("last_message_at", { ascending: false, nullsFirst: false });
  // A failed query must not look like an empty pipeline. The error page takes over instead.
  if (error) throw new Error(`Could not load the pipeline: ${error.message}`);
  const leads = (leadRows ?? []) as unknown as Lead[];

  const won = leads
    .filter((l) => l.stage === "won")
    .reduce((sum, l) => sum + (l.quoted_price_myr ?? 0), 0);

  return (
    <div className="flex h-full w-full flex-col gap-4 overflow-hidden p-4 sm:p-6 lg:p-8">
      <PageHeader
        className="shrink-0"
        title="Pipeline"
        description={`${leads.length} ${leads.length === 1 ? "customer" : "customers"}${won > 0 ? `, ${rm(won)} won` : ""}.`}
      />
      <PipelineBoard leads={leads} coldAfterDays={business.cold_after_days} />
    </div>
  );
}
