import { STAGE_DOT, type Stage } from "@/lib/leads";
import { cn } from "@/lib/utils";

// The small coloured dot that marks a pipeline stage.
export function StageDot({ stage, className }: { stage: Stage; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("size-2 shrink-0 rounded-full", className)}
      style={{ background: STAGE_DOT[stage] }}
    />
  );
}
