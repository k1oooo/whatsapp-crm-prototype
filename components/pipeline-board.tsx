"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { LeadCard } from "@/components/LeadCard";
import { Input } from "@/components/ui/input";
import { StageDot } from "@/components/stage-dot";
import { Select, SelectContent, SelectItem, SelectOption, SelectTrigger, SelectValue } from "@/components/ui/select";
import { STAGES, STAGE_DOT, STAGE_LABEL, displayName, rm, type Lead, type Stage } from "@/lib/leads";
import { cn } from "@/lib/utils";

// Phones: one stage at a time, picked from a dropdown that shows each stage with its count.
// Tablet and laptop: every stage side by side, scrolling sideways, with the next column peeking in.
// Wide screens (xl): all five stages fit in a grid.
export function PipelineBoard({ leads, coldAfterDays }: { leads: Lead[]; coldAfterDays: number }) {
  const [query, setQuery] = useState("");
  const [mobileStage, setMobileStage] = useState<Stage>(() => {
    // Open on the first stage that has someone in it, and prefer one with a chat waiting for you.
    const waiting = STAGES.find((s) => leads.some((l) => l.stage === s && l.pending_decision));
    return waiting ?? STAGES.find((s) => leads.some((l) => l.stage === s)) ?? STAGES[0];
  });

  const q = query.trim().toLowerCase();
  const shown = useMemo(
    () =>
      leads.filter(
        (l) => !q || displayName(l).toLowerCase().includes(q) || l.wa_contact_number.includes(q.replace(/^\+/, "")),
      ),
    [leads, q],
  );

  const byStage = useMemo(() => {
    const map = new Map<Stage, Lead[]>();
    for (const stage of STAGES) {
      // Customers waiting for you go to the top of their column. The rest keep their order
      // (most recent message first).
      const inStage = shown.filter((l) => l.stage === stage);
      map.set(stage, [...inStage.filter((l) => l.pending_decision), ...inStage.filter((l) => !l.pending_decision)]);
    }
    return map;
  }, [shown]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="relative shrink-0 sm:max-w-sm">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name or number"
          aria-label="Search the pipeline"
          className="pl-9"
        />
      </div>

      {/* Phones only: a dropdown for the stage, with counts. */}
      <div className="shrink-0 md:hidden">
        <Select value={mobileStage} onValueChange={(v) => setMobileStage(v as Stage)}>
          <SelectTrigger className="w-full" aria-label="Stage">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STAGES.map((stage) => (
              <SelectItem key={stage} value={stage}>
                <SelectOption leading={<StageDot stage={stage} />} count={byStage.get(stage)?.length ?? 0}>
                  {STAGE_LABEL[stage]}
                </SelectOption>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div
        className="flex min-h-0 flex-1 snap-x gap-4 md:overflow-x-auto md:pb-2 xl:grid xl:grid-cols-5 xl:overflow-hidden"
        style={{ scrollbarWidth: "thin" }}
      >
        {STAGES.map((stage) => {
          const inStage = byStage.get(stage) ?? [];
          const value = inStage.reduce((sum, l) => sum + (l.quoted_price_myr ?? 0), 0);
          return (
            <section
              key={stage}
              aria-label={STAGE_LABEL[stage]}
              className={cn(
                "min-h-0 w-full snap-start flex-col rounded-xl border bg-muted/20 p-3 md:w-72 md:shrink-0 xl:w-auto",
                stage === mobileStage ? "flex" : "hidden md:flex",
              )}
            >
              <h2 className="mb-3 flex shrink-0 items-center gap-2 font-heading text-base font-bold">
                <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ background: STAGE_DOT[stage] }} />
                <span className="truncate">{STAGE_LABEL[stage]}</span>
                <span className="font-sans font-normal text-muted-foreground">{inStage.length}</span>
                {value > 0 && <span className="ml-auto font-sans text-sm font-normal text-muted-foreground">{rm(value)}</span>}
              </h2>

              <div className="flex-1 overflow-y-auto pr-1" style={{ scrollbarWidth: "thin" }}>
                {inStage.length === 0 ? (
                  <EmptyState className="p-4 sm:p-4" title={q ? "No match" : "No customers here"} />
                ) : (
                  <ul className="flex flex-col gap-3">
                    {inStage.map((lead) => (
                      <li key={lead.id}>
                        <LeadCard lead={lead} coldAfterDays={coldAfterDays} />
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
