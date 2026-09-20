"use client";

import { PenLine } from "lucide-react";
import { LeadEditForm } from "@/components/LeadEditForm";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import type { Lead } from "@/lib/leads";

export function DetailsSheet({ lead }: { lead: Lead }) {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm">
          <PenLine />
          <span className="hidden sm:inline">Details</span>
        </Button>
      </SheetTrigger>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Customer details</SheetTitle>
          <SheetDescription>Fix anything the assistant got wrong.</SheetDescription>
        </SheetHeader>
        <LeadEditForm lead={lead} />
      </SheetContent>
    </Sheet>
  );
}
