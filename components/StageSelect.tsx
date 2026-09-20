"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { moveStage } from "@/app/dashboard/actions";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { STAGES, STAGE_DOT, STAGE_LABEL, type Stage } from "@/lib/leads";
import { cn } from "@/lib/utils";

// Render with key={stage} so it resets when the server changes the stage.
export function StageSelect({
  leadId,
  stage,
  compact = false,
  className,
}: {
  leadId: string;
  stage: Stage;
  compact?: boolean;
  className?: string;
}) {
  const [value, setValue] = useState<Stage>(stage);
  const [pending, start] = useTransition();

  function change(next: string) {
    setValue(next as Stage);
    start(async () => {
      await moveStage(leadId, next as Stage);
      toast.success(`Moved to ${STAGE_LABEL[next as Stage]}`);
    });
  }

  return (
    <Select value={value} onValueChange={change} disabled={pending}>
      <SelectTrigger aria-label="Stage" className={cn(compact && "h-8 px-3 text-xs", className)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {STAGES.map((s) => (
          <SelectItem key={s} value={s}>
            <span className="flex items-center gap-2">
              <span aria-hidden className="size-2 rounded-full" style={{ background: STAGE_DOT[s] }} />
              {STAGE_LABEL[s]}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
