"use client";

import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cn } from "@/lib/utils";

function Tabs({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      className={cn("flex flex-col gap-2", className)}
      {...props}
    />
  );
}

function TabsList({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn(
        // Every page hides this below sm and shows a TabSelect dropdown instead (see
        // components/ui/tab-select.tsx), so this only ever has to render at sm+, sharing its row
        // with other controls (e.g. Knowledge base's six categories plus a "Preview" button). A
        // fixed-height single-row pill can't fit that on a merely-wide-not-huge window: locking the
        // row to one line either clips tabs against whatever sits next to it or squeezes them
        // unreadably thin. Wrapping onto a second row instead, inside a plain rounded rectangle
        // (not a full capsule, which looks broken once it's more than one row tall) keeps every
        // tab fully visible and tappable at any width without clipping, squeezing, or scrolling.
        "inline-flex w-full flex-wrap items-center gap-1 rounded-2xl bg-muted p-1",
        className,
      )}
      {...props}
    />
  );
}

function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        "inline-flex h-10 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-full px-3 text-sm font-semibold text-muted-foreground outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/40 data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-sm",
        className,
      )}
      {...props}
    />
  );
}

function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn("outline-none", className)}
      {...props}
    />
  );
}

export { Tabs, TabsList, TabsTrigger, TabsContent };
