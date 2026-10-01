"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { moveStage } from "@/app/dashboard/actions";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { STAGES, STAGE_LABEL, type Stage } from "@/lib/leads";

// Lets the owner put a customer in the right stage, for example Won or Lost when they know the
// outcome. It saves straight away. Won and Lost stay put, so the assistant does not reopen them.
export function StageSelect({ leadId, stage }: { leadId: string; stage: Stage }) {
  const [value, setValue] = useState<Stage>(stage);
  const [pending, start] = useTransition();

  function change(next: string) {
    const prev = value;
    const target = next as Stage;
    setValue(target);
    start(async () => {
      const res = await moveStage(leadId, target);
      if (res.error) {
        setValue(prev);
        toast.error(res.error);
      } else {
        toast.success(`Moved to ${STAGE_LABEL[target]}`);
      }
    });
  }

  return (
    <div className="grid gap-1.5">
      <Label htmlFor="stage-select">Stage</Label>
      <div className="flex items-center gap-2">
        <Select value={value} onValueChange={change} disabled={pending}>
          <SelectTrigger id="stage-select" className="w-full sm:w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STAGES.map((s) => (
              <SelectItem key={s} value={s}>
                {STAGE_LABEL[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {pending && <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden />}
      </div>
      <p className="text-sm text-muted-foreground">Saved as soon as you pick one.</p>
    </div>
  );
}
