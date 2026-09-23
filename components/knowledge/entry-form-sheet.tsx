"use client";

import { useState, useTransition, type FormEvent, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { createKnowledgeEntry, updateKnowledgeEntry } from "@/app/dashboard/knowledge/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { KB_CATEGORY_HINT, type KbCategory, type KbEntry } from "@/lib/knowledge";

// Add and edit share one form: FAQ labels its fields as a question and answer, everything else as
// a name and details.
export function EntryFormSheet({
  category,
  entry,
  trigger,
}: {
  category: KbCategory;
  entry?: KbEntry;
  trigger: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const isFaq = category === "faq";
  const editing = !!entry;

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    start(async () => {
      const res = editing ? await updateKnowledgeEntry(entry.id, {}, data) : await createKnowledgeEntry({}, data);
      if (res.error) {
        toast.error(res.error);
      } else {
        toast.success(editing ? "Saved" : "Added");
        setOpen(false);
      }
    });
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>{trigger}</SheetTrigger>
      <SheetContent>
        <form onSubmit={submit} className="flex h-full flex-col">
          <SheetHeader>
            <SheetTitle>{editing ? "Edit entry" : "Add entry"}</SheetTitle>
            <SheetDescription>{KB_CATEGORY_HINT[category]}</SheetDescription>
          </SheetHeader>

          <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4">
            <input type="hidden" name="category" value={category} />
            <div className="grid gap-1.5">
              <Label htmlFor="title">{isFaq ? "Question" : "Name"}</Label>
              <Input
                id="title"
                name="title"
                required
                defaultValue={entry?.title}
                placeholder={isFaq ? "Do you deliver on weekends?" : "Cupcakes"}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="content">{isFaq ? "Answer" : "Details"}</Label>
              <Textarea
                id="content"
                name="content"
                required
                rows={6}
                defaultValue={entry?.content}
                placeholder={isFaq ? "Yes, Saturday only, 10am to 4pm." : "RM3 each. Minimum order 12."}
              />
            </div>
          </div>

          <div className="mt-auto flex items-center justify-end gap-3 border-t p-4">
            <SheetClose asChild>
              <Button type="button" variant="ghost">
                Cancel
              </Button>
            </SheetClose>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="animate-spin" />}
              {editing ? "Save" : "Add"}
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
