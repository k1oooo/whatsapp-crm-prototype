"use client";

import { useState, useTransition } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { deleteKnowledgeEntry } from "@/app/dashboard/knowledge/actions";
import { EntryFormSheet } from "@/components/knowledge/entry-form-sheet";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { KbEntry } from "@/lib/knowledge";

export function EntryCard({ entry }: { entry: KbEntry }) {
  const [pending, start] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const isFaq = entry.category === "faq";

  function remove() {
    setConfirming(false);
    start(async () => {
      const res = await deleteKnowledgeEntry(entry.id);
      if (res.error) toast.error(res.error);
      else toast.success("Deleted");
    });
  }

  return (
    <Card className="flex flex-col gap-2 p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="font-semibold">
          {isFaq ? `Q: ${entry.title}` : entry.title}
          {entry.price_myr != null && (
            <span className="ml-2 rounded-md bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground">
              RM{Number(entry.price_myr)}
            </span>
          )}
        </p>
        <div className="flex shrink-0 items-center">
          <EntryFormSheet
            category={entry.category}
            entry={entry}
            trigger={
              <Button variant="ghost" size="icon" aria-label={`Edit ${entry.title}`}>
                <Pencil className="size-4" aria-hidden />
              </Button>
            }
          />
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Delete ${entry.title}`}
            className="ml-2"
            onClick={() => setConfirming(true)}
            disabled={pending}
          >
            <Trash2 className="size-4" aria-hidden />
          </Button>
        </div>
      </div>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Delete "${entry.title}"?`}
        description="The assistant will no longer know this. You can add it again later."
        confirmLabel="Delete"
        pending={pending}
        onConfirm={remove}
      />
      <p className="whitespace-pre-wrap text-muted-foreground">{isFaq ? `A: ${entry.content}` : entry.content}</p>
    </Card>
  );
}
