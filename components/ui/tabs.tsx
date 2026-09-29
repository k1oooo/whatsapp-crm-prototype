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
        // Scrolls sideways on small screens instead of squeezing or wrapping tabs.
        "no-scrollbar inline-flex h-12 w-full snap-x snap-proximity items-center gap-1 overflow-x-auto overscroll-x-contain rounded-full bg-muted p-1 sm:h-10 sm:overflow-visible",
        className,
      )}
      {...props}
    />
  );
}

function TabsTrigger({
  className,
  onClick,
  onFocus,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  // Keep the chosen tab visible when the bar is scrolled.
  function reveal(el: HTMLElement) {
    el.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }

  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      onClick={(e) => {
        onClick?.(e);
        reveal(e.currentTarget);
      }}
      onFocus={(e) => {
        onFocus?.(e);
        reveal(e.currentTarget);
      }}
      className={cn(
        "inline-flex h-10 flex-auto shrink-0 snap-center items-center justify-center gap-2 whitespace-nowrap rounded-full px-4 text-sm font-semibold sm:h-8 sm:flex-1 sm:px-3 text-muted-foreground outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/40 data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-sm",
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
