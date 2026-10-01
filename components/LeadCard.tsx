import Link from "next/link";
import { ChatAvatar } from "@/components/chat-avatar";
import { OrderLines } from "@/components/order-lines";
import { NeedsYouBadge, PaidBadge, QuietBadge, WaitingPaymentBadge } from "@/components/lead-status";
import { Card } from "@/components/ui/card";
import { chatTime, displayName, isCold, lastTouch, rm, type Lead } from "@/lib/leads";

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
          {lead.pending_decision && <NeedsYouBadge reason={lead.human_reason} withPrefix />}
          {lead.order_status === "paid" && <PaidBadge />}
          {lead.order_status === "confirmed" && <WaitingPaymentBadge />}
          {cold && !lead.pending_decision && <QuietBadge />}
        </div>
      )}

      <div className="rounded-lg bg-muted/70 p-2.5">
        <OrderLines lead={lead} />
      </div>

      {lead.quoted_price_myr ? (
        <p className="text-right font-heading text-lg font-bold">{rm(lead.quoted_price_myr)}</p>
      ) : null}
    </Card>
  );
}
