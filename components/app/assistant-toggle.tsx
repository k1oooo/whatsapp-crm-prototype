"use client";

import { useState, useTransition } from "react";
import { Bot } from "lucide-react";
import { toast } from "sonner";
import { toggleAutoReply } from "@/app/dashboard/actions";
import { Switch } from "@/components/ui/switch";

// One switch to pause or resume the assistant, always visible in the sidebar.
export function AssistantToggle({ initial, collapsed = false }: { initial: boolean; collapsed?: boolean }) {
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

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={() => change(!on)}
        disabled={pending}
        aria-pressed={on}
        aria-label={on ? "Assistant is on. Click to pause." : "Assistant is paused. Click to turn on."}
        title={on ? "Assistant is on. Click to pause." : "Assistant is paused. Click to turn on."}
        className={`relative mx-auto flex size-11 items-center justify-center rounded-xl border outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:opacity-60 ${on ? "bg-secondary text-primary" : "bg-muted text-muted-foreground"}`}
      >
        <Bot className="size-5" aria-hidden />
        <span
          aria-hidden
          className={`absolute top-1.5 right-1.5 size-2.5 rounded-full border-2 border-card ${on ? "bg-primary" : "bg-muted-foreground"}`}
        />
      </button>
    );
  }

  return (
    <div className="flex items-center gap-3 rounded-xl border bg-background p-3">
      <span
        className={`flex size-9 items-center justify-center rounded-lg ${on ? "bg-secondary text-primary" : "bg-muted text-muted-foreground"}`}
      >
        <Bot className="size-5" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p id="assistant-label" className="text-sm leading-tight font-semibold">
          Assistant
        </p>
        <p className="text-xs text-muted-foreground">{on ? "Answering customers" : "Paused"}</p>
      </div>
      <Switch checked={on} onCheckedChange={change} disabled={pending} aria-labelledby="assistant-label" />
    </div>
  );
}
