"use client";

import { useState, useTransition } from "react";
import { Bot } from "lucide-react";
import { toast } from "sonner";
import { toggleAutoReply } from "@/app/dashboard/actions";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

function useAssistant(initial: boolean) {
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

  return { on, pending, change };
}

// The switch that pauses or resumes the assistant. It is the emergency stop, so it is always
// within reach: in the sidebar on larger screens, and in the top bar on phones.
//
// Expanded sidebar: a row with the switch as the only control.
// Collapsed sidebar: a single icon button.
export function AssistantToggle({
  initial,
  collapsed = false,
}: {
  initial: boolean;
  collapsed?: boolean;
}) {
  const { on, pending, change } = useAssistant(initial);
  const label = on ? "Assistant is on. Pause it." : "Assistant is paused. Turn it on.";

  const tile = (
    <span
      aria-hidden
      className={cn(
        "relative flex size-9 shrink-0 items-center justify-center rounded-lg transition-colors",
        on ? "bg-secondary text-primary" : "bg-muted text-muted-foreground",
      )}
    >
      <Bot className="size-5" />
      {collapsed && (
        <span
          className={cn(
            "absolute top-0.5 right-0.5 size-2.5 rounded-full border-2 border-card",
            on ? "bg-primary" : "bg-muted-foreground",
          )}
        />
      )}
    </span>
  );

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={() => change(!on)}
        disabled={pending}
        aria-pressed={on}
        aria-label={label}
        title={label}
        className="flex h-11 w-full items-center justify-center rounded-xl border bg-background outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:opacity-60"
      >
        {tile}
      </button>
    );
  }

  return (
    <div className="flex h-11 w-full items-center gap-3 overflow-hidden rounded-xl border bg-background p-[3px] pr-3 whitespace-nowrap">
      {tile}
      <div className="min-w-0 flex-1">
        <p className="text-sm leading-tight font-semibold">Assistant</p>
        <p className="truncate text-xs text-muted-foreground">{on ? "Answering customers" : "Paused"}</p>
      </div>
      <Switch checked={on} onCheckedChange={change} disabled={pending} aria-label="Assistant on or off" />
    </div>
  );
}

// The same control for the phone's top bar: one line, one tap, with the state spelled out.
export function AssistantToggleCompact({ initial }: { initial: boolean }) {
  const { on, pending, change } = useAssistant(initial);

  return (
    <label className="flex h-11 shrink-0 cursor-pointer items-center gap-2 rounded-full border bg-background pr-3 pl-3">
      <Bot className={cn("size-4", on ? "text-primary" : "text-muted-foreground")} aria-hidden />
      <span className="text-sm font-medium">{on ? "Assistant on" : "Assistant paused"}</span>
      <Switch checked={on} onCheckedChange={change} disabled={pending} aria-label="Assistant on or off" />
    </label>
  );
}
