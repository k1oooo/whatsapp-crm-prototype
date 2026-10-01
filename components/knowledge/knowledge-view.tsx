"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  CircleHelp,
  Clock,
  FileText,
  MapPin,
  Plus,
  Sparkles,
  Tag,
  UtensilsCrossed,
} from "lucide-react";
import { toast } from "sonner";
import { loadStarterKnowledge } from "@/app/dashboard/knowledge/actions";
import { DocumentsPanel, type DocSummary } from "@/components/knowledge/documents-panel";
import { EntryCard } from "@/components/knowledge/entry-card";
import { EntryFormSheet } from "@/components/knowledge/entry-form-sheet";
import { FactsPreview } from "@/components/knowledge/facts-preview";
import { OtherNotesForm } from "@/components/knowledge/other-notes-form";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { TabSelect } from "@/components/ui/tab-select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  KB_CATEGORIES,
  KB_CATEGORY_HINT,
  KB_CATEGORY_LABEL,
  type KbCategory,
  type KbEntry,
} from "@/lib/knowledge";

const ICON: Record<KbCategory, typeof UtensilsCrossed> = {
  menu: UtensilsCrossed,
  location: MapPin,
  hours: Clock,
  policy: Tag,
  faq: CircleHelp,
  other: Tag,
};

function Section({
  category,
  entries,
}: {
  category: KbCategory;
  entries: KbEntry[];
}) {
  const Icon = ICON[category];
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-md text-muted-foreground">
          {KB_CATEGORY_HINT[category]}
        </p>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
          <FactsPreview />
          <EntryFormSheet
            category={category}
            trigger={
              <Button>
                <Plus />
                Add {category === "faq" ? "question" : "entry"}
              </Button>
            }
          />
        </div>
      </div>

      {entries.length === 0 ? (
        <EmptyState icon={Icon} title="Nothing here yet">
          The assistant can only answer about what you add. Nothing here means
          it hands the customer to you instead.
        </EmptyState>
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

// The category tabs, plus one more for uploaded PDFs.
type Tab = KbCategory | "documents";

export function KnowledgeView({
  entries,
  otherNotes,
  documents,
  prefill,
}: {
  entries: KbEntry[];
  otherNotes: string;
  documents: DocSummary[];
  /** An answer the owner just gave in a chat, offered as a new question and answer. */
  prefill?: { title: string; content: string } | null;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>(prefill ? "faq" : "menu");
  const [pending, start] = useTransition();
  const empty = entries.length === 0 && documents.length === 0;

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
              Add a sample menu, hours, location and FAQ, then edit it to match
              your business.
            </p>
          </div>
          <Button
            variant="outline"
            onClick={fillExample}
            disabled={pending}
            className="shrink-0"
          >
            <Sparkles />
            Fill with an example
          </Button>
        </div>
      )}

      {prefill && (
        <EntryFormSheet
          category="faq"
          defaultOpen
          prefill={prefill}
          onClosed={() => router.replace("/dashboard/knowledge")}
          trigger={<span className="hidden" />}
        />
      )}

      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
        <div className="mb-6 flex flex-col gap-3">
          {/* Phones get a single tappable dropdown instead of a tab row */}
          <div className="sm:hidden w-full">
            <TabSelect
              value={tab}
              onValueChange={setTab}
              aria-label="Knowledge base category"
              options={[
                ...KB_CATEGORIES.map((c) => ({
                  value: c as Tab,
                  label: KB_CATEGORY_LABEL[c],
                  count:
                    c === "other"
                      ? undefined
                      : entries.filter((e) => e.category === c).length || undefined,
                })),
                {
                  value: "documents" as Tab,
                  label: "PDF files",
                  icon: FileText,
                  count: documents.length || undefined,
                },
              ]}
            />
          </div>

          {/* Desktop tabs strictly forced onto a single horizontal scrollable line */}
          <div className="hidden sm:block overflow-x-auto pb-1">
            <TabsList className="inline-flex w-max">
              {KB_CATEGORIES.map((c) => {
                const count =
                  c === "other"
                    ? undefined
                    : entries.filter((e) => e.category === c).length;
                return (
                  <TabsTrigger key={c} value={c}>
                    {KB_CATEGORY_LABEL[c]}
                    {count !== undefined && count > 0 && (
                      <span className="ml-2 text-muted-foreground">
                        {count}
                      </span>
                    )}
                  </TabsTrigger>
                );
              })}
              <TabsTrigger value="documents">
                PDF files
                {documents.length > 0 && (
                  <span className="ml-2 text-muted-foreground">
                    {documents.length}
                  </span>
                )}
              </TabsTrigger>
            </TabsList>
          </div>
        </div>

        <div>
          {KB_CATEGORIES.filter((c) => c !== "other").map((c) => (
            <TabsContent key={c} value={c} className="mt-0">
              <Section
                category={c}
                entries={entries.filter((e) => e.category === c)}
              />
            </TabsContent>
          ))}

          <TabsContent value="other" className="mt-0">
            <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
              <p className="max-w-md text-muted-foreground">
                {KB_CATEGORY_HINT.other}
              </p>
              <FactsPreview />
            </div>
            <OtherNotesForm initial={otherNotes} />
          </TabsContent>

          <TabsContent value="documents" className="mt-0">
            <DocumentsPanel documents={documents} />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
