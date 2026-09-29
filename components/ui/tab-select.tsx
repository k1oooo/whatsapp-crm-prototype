"use client";

import type { LucideIcon } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

export interface TabSelectOption<T extends string> {
  value: T;
  label: string;
  icon?: LucideIcon;
}

/**
 * A dropdown that drives the same value/onValueChange as a <Tabs> root. Pairing this with
 * `hidden sm:inline-flex` on <TabsList> gives phones a single tappable field instead of a row of
 * small targets: no accidental adjacent-tab taps, no sideways scrolling to find a section, and the
 * current section's name is always fully visible. Desktop is unaffected and keeps the pill tabs.
 * Full width on mobile, matching how the tab bar it replaces spans the row on desktop.
 */
export function TabSelect<T extends string>({
  value,
  onValueChange,
  options,
  className,
  "aria-label": ariaLabel,
}: {
  value: T;
  onValueChange: (value: T) => void;
  options: readonly TabSelectOption<T>[];
  className?: string;
  "aria-label": string;
}) {
  return (
    <Select value={value} onValueChange={(v) => onValueChange(v as T)}>
      <SelectTrigger className={cn("w-full sm:hidden", className)} aria-label={ariaLabel}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            <span className="flex items-center gap-2">
              {o.icon && <o.icon className="size-4 text-muted-foreground" aria-hidden />}
              {o.label}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
