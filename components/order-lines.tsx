import { CalendarClock, ShoppingBag } from "lucide-react";
import { formatDeadline, parseOrderSummary, type Lead } from "@/lib/leads";

// What was ordered, and when and where. Used on the pipeline card and under the chat header.
export function OrderLines({ lead }: { lead: Lead }) {
  let items: string | null = null;
  let where: string | null = null;

  if (lead.order_summary) {
    ({ items, where } = parseOrderSummary(lead.order_summary, lead.name));
  } else {
    items = lead.need;
    where = lead.deadline ? `Needed by ${formatDeadline(lead.deadline)}` : null;
  }

  return (
    <ul className="flex flex-col gap-1.5 text-sm">
      <li className="flex gap-2">
        <ShoppingBag className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className={items ? "font-medium" : "text-muted-foreground"}>{items ?? "No order yet"}</span>
      </li>
      {where && (
        <li className="flex gap-2">
          <CalendarClock className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span>{where}</span>
        </li>
      )}
    </ul>
  );
}
