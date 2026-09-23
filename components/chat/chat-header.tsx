import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { ChatAvatar } from "@/components/chat-avatar";
import { DetailsSheet } from "@/components/chat/details-sheet";
import { StagePill } from "@/components/stage-pill";
import { Button } from "@/components/ui/button";
import { displayName, type Lead } from "@/lib/leads";

export function ChatHeader({ lead }: { lead: Lead }) {
  return (
    <header className="flex items-center gap-3 border-b bg-card px-3 py-3 sm:px-5">
      <Button asChild variant="ghost" size="icon" className="-ml-1 lg:hidden">
        <Link href="/dashboard" aria-label="Back to inbox">
          <ChevronLeft className="size-6" />
        </Link>
      </Button>
      <ChatAvatar name={displayName(lead)} alert={lead.pending_decision} />
      <div className="min-w-0 flex-1">
        <h1 className="truncate font-heading text-lg leading-tight font-bold">{displayName(lead)}</h1>
        <p className="truncate text-sm text-muted-foreground">+{lead.wa_contact_number}</p>
      </div>
      <StagePill stage={lead.stage} />
      <DetailsSheet lead={lead} />
    </header>
  );
}
