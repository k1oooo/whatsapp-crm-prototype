import { AssistantToggleCompact } from "@/components/app/assistant-toggle";
import { TestModeChip } from "@/components/app/test-mode-chip";

// Phones only. The assistant talks to real customers, so the pause switch is on every screen.
export function MobileTopBar({
  businessName,
  autoReply,
  testMode,
}: {
  businessName: string;
  autoReply: boolean;
  testMode: boolean;
}) {
  return (
    <header className="shrink-0 border-b bg-card px-4 py-1.5 pt-[max(0.375rem,env(safe-area-inset-top))] md:hidden">
      <div className="flex items-center justify-between gap-3">
        <span className="min-w-0 truncate font-heading text-base font-bold">{businessName}</span>
        <AssistantToggleCompact initial={autoReply} />
      </div>
      {testMode && <TestModeChip className="mb-1 whitespace-normal" />}
    </header>
  );
}
