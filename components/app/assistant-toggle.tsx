"use client";

import { useState, useTransition } from "react";
import { Bot } from "lucide-react";
import { toast } from "sonner";
import { toggleAutoReply } from "@/app/dashboard/actions";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

// One switch to pause or resume the assistant, always visible in the sidebar.
// The Bot icon stays in place open or closed. The text and the switch are revealed by the width.
export function AssistantToggle({
  initial,
  collapsed = false,
}: {
  initial: boolean;
  collapsed?: boolean;
}) {
  const [on, setOn] = useState(initial);
  const [pending, start] = useTransition();

  function change(next: boolean) {
    setOn(next);
    start(async () => {
      const res = await toggleAutoReply(next);
      if (res.error) {
        setOn(!next);
        toast.error(res.error);
      } else {
        toast.success(next ? "Assistant is on" : "Assistant is paused");
      }
    });
  }

  const label = on
    ? "Assistant is on. Click to pause."
    : "Assistant is paused. Click to turn on.";

  return (
    <div className="relative flex h-11 w-full items-center overflow-hidden rounded-xl border bg-background p-[3px] whitespace-nowrap">
      <button
        type="button"
        onClick={() => change(!on)}
        disabled={pending}
        aria-pressed={on}
        aria-label={label}
        title={collapsed ? label : undefined}
        className={cn(
          "relative flex size-9 shrink-0 items-center justify-center rounded-lg outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:opacity-60",
          on ? "bg-secondary text-primary" : "bg-muted text-muted-foreground",
        )}
      >
        <Bot className="size-5" aria-hidden />
        <span
          aria-hidden
          className={cn(
            "absolute top-0.5 right-0.5 size-2.5 rounded-full border-2 border-card transition-opacity duration-200",
            on ? "bg-primary" : "bg-muted-foreground",
            collapsed ? "opacity-100 delay-100" : "opacity-0",
          )}
        />
      </button>

      <div
        aria-hidden
        className={cn(
          "ml-3 min-w-0 transition-opacity duration-200",
          collapsed ? "opacity-0" : "opacity-100 delay-100",
        )}
      >
        <p className="text-sm leading-tight font-semibold">Assistant</p>
        <p className="text-xs text-muted-foreground">
          {on ? "Answering customers" : "Paused"}
        </p>
      </div>

      <div className="pointer-events-none absolute inset-y-0 left-0 flex w-[234px] items-center justify-end pr-3">
        <Switch
          checked={on}
          onCheckedChange={change}
          disabled={pending}
          inert={collapsed}
          aria-label="Assistant on or off"
          className={cn(
            "pointer-events-auto transition-opacity duration-200",
            collapsed ? "opacity-0" : "opacity-100 delay-100",
          )}
        />
      </div>
    </div>
  );
}
