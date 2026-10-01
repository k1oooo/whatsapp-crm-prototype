"use client";

import { PenLine } from "lucide-react";
import { LeadEditForm } from "@/components/LeadEditForm";
import { StageSelect } from "@/components/chat/stage-select";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import type { Lead } from "@/lib/leads";

export function DetailsSheet({ lead }: { lead: Lead }) {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm" aria-label="Customer details" className="max-md:w-auto">
          <PenLine />
          <span className="hidden sm:inline">Details</span>
        </Button>
      </SheetTrigger>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Customer details</SheetTitle>
          <SheetDescription>Fix anything the assistant got wrong.</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-5 overflow-y-auto">
          <StageSelect leadId={lead.id} stage={lead.stage} />
          <LeadEditForm lead={lead} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
