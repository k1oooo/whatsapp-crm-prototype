"use client";

import { useState, useTransition } from "react";
import { CircleHelp, Clock, MapPin, Plus, Sparkles, Tag, UtensilsCrossed } from "lucide-react";
import { toast } from "sonner";
import { loadStarterKnowledge } from "@/app/dashboard/knowledge/actions";
import { EntryCard } from "@/components/knowledge/entry-card";
import { EntryFormSheet } from "@/components/knowledge/entry-form-sheet";
import { FactsPreview } from "@/components/knowledge/facts-preview";
import { OtherNotesForm } from "@/components/knowledge/other-notes-form";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { KB_CATEGORIES, KB_CATEGORY_HINT, KB_CATEGORY_LABEL, type KbCategory, type KbEntry } from "@/lib/knowledge";

const ICON: Record<KbCategory, typeof UtensilsCrossed> = {
  menu: UtensilsCrossed,
  location: MapPin,
  hours: Clock,
  policy: Tag,
  faq: CircleHelp,
  other: Tag,
};

function Section({ category, entries }: { category: KbCategory; entries: KbEntry[] }) {
  const Icon = ICON[category];
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-md text-muted-foreground">{KB_CATEGORY_HINT[category]}</p>
        <EntryFormSheet
          category={category}
          trigger={
            <Button size="sm">
              <Plus />
              Add {category === "faq" ? "question" : "entry"}
            </Button>
          }
        />
      </div>

      {entries.length === 0 ? (
        <div className="rounded-xl border border-dashed p-8 text-center">
          <Icon className="mx-auto size-8 text-muted-foreground" aria-hidden />
          <p className="mt-2 font-semibold">Nothing here yet</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
            The assistant can only answer about what you add. Nothing here means it hands the customer to you
            instead.
          </p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {entries.map((e) => (
            <EntryCard key={e.id} entry={e} />
          ))}
        </div>
      )}
    </div>
  );
}

export function KnowledgeView({ entries, otherNotes }: { entries: KbEntry[]; otherNotes: string }) {
  const [tab, setTab] = useState<KbCategory>("menu");
  const [pending, start] = useTransition();
  const empty = entries.length === 0;

  function fillExample() {
    start(async () => {
      const res = await loadStarterKnowledge();
      if (res.error) toast.error(res.error);
      else toast.success("Example added", { description: res.notice });
    });
  }

  return (
    <div className="flex flex-col gap-6">
      {empty && (
        <div className="flex flex-col items-start gap-3 rounded-xl border bg-secondary/40 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-semibold">Starting from scratch?</p>
            <p className="text-sm text-muted-foreground">
              Add a sample menu, hours, location and FAQ, then edit it to match your business.
            </p>
          </div>
          <Button variant="outline" onClick={fillExample} disabled={pending} className="shrink-0">
            <Sparkles />
            Fill with an example
          </Button>
        </div>
      )}

      <Tabs value={tab} onValueChange={(v) => setTab(v as KbCategory)}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabsList className="flex-wrap">
            {KB_CATEGORIES.map((c) => {
              const count = c === "other" ? undefined : entries.filter((e) => e.category === c).length;
              return (
                <TabsTrigger key={c} value={c}>
                  {KB_CATEGORY_LABEL[c]}
                  {!!count && <span className="text-muted-foreground">{count}</span>}
                </TabsTrigger>
              );
            })}
          </TabsList>
          <FactsPreview />
        </div>

        {KB_CATEGORIES.filter((c) => c !== "other").map((c) => (
          <TabsContent key={c} value={c}>
            <Section category={c} entries={entries.filter((e) => e.category === c)} />
          </TabsContent>
        ))}

        <TabsContent value="other">
          <p className="mb-4 max-w-md text-muted-foreground">{KB_CATEGORY_HINT.other}</p>
          <OtherNotesForm initial={otherNotes} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
