import { redirect } from "next/navigation";
import { LeadCard } from "@/components/LeadCard";
import { createClient } from "@/lib/supabase/server";
import { getOrCreateBusiness } from "@/lib/business";
import {
  LEAD_COLUMNS,
  STAGES,
  STAGE_DOT,
  STAGE_LABEL,
  rm,
  type Lead,
} from "@/lib/leads";

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

  const { data: leadRows } = await supabase
    .from("leads")
    .select(LEAD_COLUMNS)
    .eq("business_id", business.id)
    .order("last_message_at", { ascending: false, nullsFirst: false });
  const leads = (leadRows ?? []) as unknown as Lead[];

  const won = leads
    .filter((l) => l.stage === "won")
    .reduce((sum, l) => sum + (l.quoted_price_myr ?? 0), 0);

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 md:gap-6 p-4 sm:p-6 lg:p-8">
      <header>
        <h1 className="font-heading text-2xl md:text-3xl font-bold">
          Pipeline
        </h1>
        <p className="mt-1 text-sm md:text-base text-muted-foreground">
          {leads.length} {leads.length === 1 ? "customer" : "customers"}
          {won > 0 ? `, ${rm(won)} won` : ""}. Change a stage with the dropdown
          on each card.
        </p>
      </header>

      {/* 
        Mobile: Horizontal scrolling flex container with snapping.
        Desktop (xl): 5-column CSS Grid.
      */}
      <div
        className="flex snap-x snap-mandatory gap-4 overflow-x-auto pb-6 xl:grid xl:grid-cols-5 xl:overflow-visible"
        style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
      >
        {STAGES.map((stage) => {
          const inStage = leads.filter((l) => l.stage === stage);
          const value = inStage.reduce(
            (sum, l) => sum + (l.quoted_price_myr ?? 0),
            0,
          );
          return (
            <section
              key={stage}
              aria-label={STAGE_LABEL[stage]}
              className="w-[85vw] max-w-[320px] sm:w-72 shrink-0 snap-start xl:w-auto"
            >
              <h2 className="mb-3 flex items-center gap-2 font-heading text-sm md:text-base font-bold">
                <span
                  aria-hidden
                  className="size-2.5 shrink-0 rounded-full"
                  style={{ background: STAGE_DOT[stage] }}
                />
                <span className="truncate">{STAGE_LABEL[stage]}</span>
                <span className="font-sans font-normal text-muted-foreground">
                  {inStage.length}
                </span>
                {value > 0 && (
                  <span className="ml-auto font-sans text-xs md:text-sm font-normal text-muted-foreground">
                    {rm(value)}
                  </span>
                )}
              </h2>

              {inStage.length === 0 ? (
                <p className="rounded-xl border border-dashed p-4 text-center text-xs md:text-sm text-muted-foreground">
                  No customers here
                </p>
              ) : (
                <ul className="flex flex-col gap-3">
                  {inStage.map((lead) => (
                    <li key={lead.id}>
                      <LeadCard
                        lead={lead}
                        coldAfterDays={business.cold_after_days}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
