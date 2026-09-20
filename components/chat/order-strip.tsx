import { OrderLines } from "@/components/order-lines";
import { Badge } from "@/components/ui/badge";
import { ORDER_LABEL, rm, type Lead } from "@/lib/leads";

// A one-glance summary of the order under the chat header.
export function OrderStrip({ lead }: { lead: Lead }) {
  if (!lead.order_summary || !lead.order_status) return null;
  const paid = lead.order_status === "paid";

  return (
    <div className="flex items-start gap-3 border-b bg-card px-3 py-3 sm:px-5">
      <div className="min-w-0 flex-1">
        <OrderLines lead={lead} />
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1.5">
        {lead.quoted_price_myr ? (
          <span className="font-heading text-lg leading-none font-bold">{rm(lead.quoted_price_myr)}</span>
        ) : null}
        <Badge variant={paid ? "success" : "info"}>{ORDER_LABEL[lead.order_status] ?? lead.order_status}</Badge>
      </div>
    </div>
  );
}
