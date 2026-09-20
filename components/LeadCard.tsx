import Link from "next/link";
import { CircleCheck, Clock } from "lucide-react";
import { ChatAvatar } from "@/components/chat-avatar";
import { OrderLines } from "@/components/order-lines";
import { ReasonIcon } from "@/components/reason-icon";
import { StageSelect } from "@/components/StageSelect";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { REASON_LABEL, chatTime, displayName, isCold, lastTouch, rm, type Lead } from "@/lib/leads";

// A customer on the pipeline board: who, status, what they ordered, price, stage.
export function LeadCard({ lead, coldAfterDays }: { lead: Lead; coldAfterDays: number }) {
  const cold = isCold(lead, coldAfterDays);
  const last = lastTouch(lead);
  const hasStatus =
    lead.pending_decision || lead.order_status === "paid" || lead.order_status === "confirmed" || cold;

  return (
    <Card className="flex flex-col gap-3 p-3.5">
      <div className="flex items-start gap-3">
        <ChatAvatar name={displayName(lead)} alert={lead.pending_decision} className="size-9 text-xs" />
        <div className="min-w-0 flex-1">
          <Link
            href={`/dashboard/leads/${lead.id}`}
            className="block truncate font-semibold outline-none hover:underline focus-visible:underline"
          >
            {displayName(lead)}
          </Link>
          {lead.name && <p className="truncate text-xs text-muted-foreground">+{lead.wa_contact_number}</p>}
        </div>
        {last && <span className="shrink-0 text-xs text-muted-foreground">{chatTime(last)}</span>}
      </div>

      {hasStatus && (
        <div className="flex flex-wrap gap-1.5">
          {lead.pending_decision && (
            <Badge variant="warning">
              <ReasonIcon reason={lead.human_reason} />
              Needs you{lead.human_reason ? `: ${REASON_LABEL[lead.human_reason] ?? lead.human_reason}` : ""}
            </Badge>
          )}
          {lead.order_status === "paid" && (
            <Badge variant="success">
              <CircleCheck />
              Paid
            </Badge>
          )}
          {lead.order_status === "confirmed" && <Badge variant="info">Waiting for payment</Badge>}
          {cold && !lead.pending_decision && (
            <Badge variant="info">
              <Clock />
              Quiet
            </Badge>
          )}
        </div>
      )}

      <div className="rounded-lg bg-muted/70 p-2.5">
        <OrderLines lead={lead} />
      </div>

      <div className="flex items-center justify-between gap-2">
        <StageSelect key={`${lead.id}-${lead.stage}`} leadId={lead.id} stage={lead.stage} compact />
        {lead.quoted_price_myr ? (
          <span className="font-heading text-lg font-bold">{rm(lead.quoted_price_myr)}</span>
        ) : null}
      </div>
    </Card>
  );
}
