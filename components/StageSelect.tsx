"use client";

import { useTransition } from "react";
import { moveStage } from "@/app/dashboard/actions";
import { STAGES, STAGE_LABEL, type Stage } from "@/lib/leads";

export function StageSelect({ leadId, stage }: { leadId: string; stage: Stage }) {
  const [pending, start] = useTransition();

  return (
    <select
      aria-label="Move to stage"
      value={stage}
      disabled={pending}
      onChange={(e) => start(() => moveStage(leadId, e.target.value as Stage))}
      className="rounded-md border border-[#D8E0DA] bg-white px-2 py-1 text-sm disabled:opacity-60"
    >
      {STAGES.map((s) => (
        <option key={s} value={s}>
          {STAGE_LABEL[s]}
        </option>
      ))}
    </select>
  );
}
