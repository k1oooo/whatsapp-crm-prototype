"use client";

import { Check, ListFilter } from "lucide-react";
import { ALL_FILTERS, STAGE_FILTERS, STATUS_FILTERS, type FilterId } from "@/components/inbox/chat-filters";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

function Row({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={active}
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left text-sm font-medium outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/40",
        active ? "border-primary bg-secondary text-foreground" : "hover:bg-accent",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "flex size-5 shrink-0 items-center justify-center rounded-md border",
          active ? "border-primary bg-primary text-primary-foreground" : "border-input",
        )}
      >
        {active && <Check className="size-3.5" />}
      </span>
      {label}
    </button>
  );
}

// A chat matches when it satisfies at least one checked filter here. Nothing checked shows everyone.
export function ChatFilterSheet({
  selected,
  onChange,
}: {
  selected: Set<FilterId>;
  onChange: (next: Set<FilterId>) => void;
}) {
  function toggle(id: FilterId) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(next);
  }

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline" size="icon" aria-label="Filter chats" className="relative shrink-0">
          <ListFilter />
          {selected.size > 0 && (
            <Badge
              variant="warning"
              className="absolute -top-1.5 -right-1.5 size-4 justify-center rounded-full p-0 text-[10px]"
            >
              {selected.size}
            </Badge>
          )}
        </Button>
      </SheetTrigger>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Filter chats</SheetTitle>
          <SheetDescription>Show chats matching any status you pick. Pick none to see everyone.</SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-5 px-4">
          <div className="flex flex-col gap-2">
            <p className="text-sm font-semibold text-muted-foreground">Status</p>
            {STATUS_FILTERS.map((f) => (
              <Row key={f.id} label={f.label} active={selected.has(f.id)} onClick={() => toggle(f.id)} />
            ))}
          </div>
          <div className="flex flex-col gap-2">
            <p className="text-sm font-semibold text-muted-foreground">Stage</p>
            {STAGE_FILTERS.map((f) => (
              <Row key={f.id} label={f.label} active={selected.has(f.id)} onClick={() => toggle(f.id)} />
            ))}
          </div>
        </div>

        <div className="mt-auto flex items-center justify-between gap-3 border-t p-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onChange(new Set())}
            disabled={selected.size === 0}
          >
            Clear
          </Button>
          <SheetClose asChild>
            <Button size="sm">Done</Button>
          </SheetClose>
        </div>
      </SheetContent>
    </Sheet>
  );
}

export const KNOWN_FILTER_IDS = new Set(ALL_FILTERS.map((f) => f.id));
