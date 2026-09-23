"use client";

import { useTransition } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { deleteKnowledgeEntry } from "@/app/dashboard/knowledge/actions";
import { EntryFormSheet } from "@/components/knowledge/entry-form-sheet";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { KbEntry } from "@/lib/knowledge";

export function EntryCard({ entry }: { entry: KbEntry }) {
  const [pending, start] = useTransition();
  const isFaq = entry.category === "faq";

  function remove() {
    if (!confirm(`Delete "${entry.title}"? The assistant will no longer know this.`)) return;
    start(async () => {
      const res = await deleteKnowledgeEntry(entry.id);
      if (res.error) toast.error(res.error);
      else toast.success("Deleted");
    });
  }

  return (
    <Card className="flex flex-col gap-2 p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="font-semibold">{isFaq ? `Q: ${entry.title}` : entry.title}</p>
        <div className="flex shrink-0 gap-1">
          <EntryFormSheet
            category={entry.category}
            entry={entry}
            trigger={
              <Button variant="ghost" size="icon" aria-label="Edit" className="size-8">
                <Pencil className="size-4" />
              </Button>
            }
          />
          <Button variant="ghost" size="icon" aria-label="Delete" className="size-8" onClick={remove} disabled={pending}>
            <Trash2 className="size-4" />
          </Button>
        </div>
      </div>
      <p className="whitespace-pre-wrap text-muted-foreground">{isFaq ? `A: ${entry.content}` : entry.content}</p>
    </Card>
  );
}
