import { STAGE_DOT, STAGE_LABEL, type Stage } from "@/lib/leads";
import { cn } from "@/lib/utils";

// Read-only display. The assistant moves a stage on its own, and the owner can change it from
// the Details sheet on the chat.
export function StagePill({ stage, compact = false }: { stage: Stage; compact?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border bg-background font-medium text-foreground",
        compact ? "px-2.5 py-1 text-xs" : "px-3 py-1.5 text-sm",
      )}
    >
      <span aria-hidden className="size-2 rounded-full" style={{ background: STAGE_DOT[stage] }} />
      {STAGE_LABEL[stage]}
    </span>
  );
}
