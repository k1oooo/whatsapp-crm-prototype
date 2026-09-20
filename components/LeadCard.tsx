import Link from "next/link";
import { StageSelect } from "@/components/StageSelect";
import {
  daysSince,
  displayName,
  formatDeadline,
  ORDER_LABEL,
  relativeDays,
  rm,
  type Lead,
} from "@/lib/leads";

export function LeadCard({ lead, cold }: { lead: Lead; cold: boolean }) {
  const chasedRecently =
    lead.last_chased_at &&
    (!lead.last_message_at || new Date(lead.last_chased_at) > new Date(lead.last_message_at));

  const activity = chasedRecently
    ? `You followed up ${relativeDays(lead.last_chased_at)}`
    : lead.last_message_at
      ? daysSince(lead.last_message_at) === 0
        ? "Active today"
        : `Last message ${relativeDays(lead.last_message_at)}`
      : "";

  return (
    <li className="rounded-lg border border-[#D8E0DA] bg-white p-3">
      <div className="flex items-start justify-between gap-2">
        <Link
          href={`/dashboard/leads/${lead.id}`}
          className="font-semibold hover:underline focus-visible:outline-2 focus-visible:outline-[#1F7A5C]"
        >
          {displayName(lead)}
        </Link>
        {cold && (
          <span className="shrink-0 rounded-full bg-[#E4EEF9] px-2 py-0.5 text-xs text-[#2F6DB5]">
            Cold
          </span>
        )}
      </div>
      {lead.name && <p className="text-xs text-[#55645E]">+{lead.wa_contact_number}</p>}

      <p className="mt-2 text-sm">{lead.need ?? "No details yet"}</p>
      <p className="mt-1 text-sm text-[#55645E]">
        {[
          lead.quoted_price_myr ? `Quoted ${rm(lead.quoted_price_myr)}` : null,
          lead.deadline ? `by ${formatDeadline(lead.deadline)}` : null,
        ]
          .filter(Boolean)
          .join(", ")}
      </p>
      {lead.order_summary && lead.order_status && lead.order_status !== "collecting" && (
        <p className="mt-2 rounded-md bg-[#EAF3EC] px-2 py-1 text-xs text-[#12251F]">
          <span className="font-semibold">{ORDER_LABEL[lead.order_status] ?? lead.order_status}:</span>{" "}
          {lead.order_summary}
        </p>
      )}
      {activity && <p className="mt-1 text-xs text-[#55645E]">{activity}</p>}

      <div className="mt-2">
        <StageSelect leadId={lead.id} stage={lead.stage} />
      </div>
    </li>
  );
}
