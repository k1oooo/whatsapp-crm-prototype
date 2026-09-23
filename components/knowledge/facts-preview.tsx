"use client";

import { useEffect, useState, useTransition } from "react";
import { Eye, Loader2 } from "lucide-react";
import { previewFacts } from "@/app/dashboard/knowledge/actions";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

// What the assistant actually reads, so the admin can sanity-check it before customers do.
export function FactsPreview() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!open) return;
    start(async () => {
      const res = await previewFacts();
      if ("error" in res) setError(res.error);
      else setText(res.text);
    });
  }, [open]);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm">
          <Eye />
          Preview
        </Button>
      </SheetTrigger>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>What the assistant reads</SheetTitle>
          <SheetDescription>Exactly what is sent to the AI, compiled from every section below.</SheetDescription>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto px-4">
          {pending ? (
            <Loader2 className="mx-auto mt-8 size-6 animate-spin text-muted-foreground" />
          ) : error ? (
            <p className="text-sm text-warning-foreground">{error}</p>
          ) : text ? (
            <pre className="whitespace-pre-wrap rounded-lg bg-muted p-3 font-mono text-sm">{text}</pre>
          ) : (
            <p className="text-sm text-muted-foreground">Nothing yet. Add an entry below to see it here.</p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
