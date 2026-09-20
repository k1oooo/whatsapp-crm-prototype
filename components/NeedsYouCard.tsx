import Link from "next/link";
import {
  REASON_LABEL,
  displayName,
  formatDeadline,
  relativeDays,
  rm,
  type LastMessage,
  type Lead,
} from "@/lib/leads";

// A chat the assistant handed to the owner. The approval itself happens inside the chat.
export function NeedsYouCard({ lead, last }: { lead: Lead; last?: LastMessage }) {
  const reason = lead.human_reason
    ? (REASON_LABEL[lead.human_reason] ?? lead.human_reason)
    : "you said you would check";

  return (
    <li className="rounded-xl border border-[#D8E0DA] border-l-4 border-l-[#B26A00] bg-white p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
        <div>
          <Link
            href={`/dashboard/leads/${lead.id}`}
            className="text-lg font-semibold hover:underline focus-visible:outline-2 focus-visible:outline-[#1F7A5C]"
          >
            {displayName(lead)}
          </Link>
          {lead.name && <p className="text-sm text-[#55645E]">+{lead.wa_contact_number}</p>}
        </div>
        <p className="rounded-full bg-[#FBEBD0] px-3 py-0.5 text-sm text-[#8A5000]">Needs you: {reason}</p>
      </div>

      {lead.handoff_note && <p className="mt-3 max-w-prose">{lead.handoff_note}</p>}

      <p className="mt-2 text-[#55645E]">
        {[
          lead.need,
          lead.quoted_price_myr ? rm(lead.quoted_price_myr) : null,
          lead.deadline ? `by ${formatDeadline(lead.deadline)}` : null,
        ]
          .filter(Boolean)
          .join(", ")}
      </p>

      {last?.body && (
        <p className="mt-3 max-w-prose border-l-2 border-[#D8E0DA] pl-3 text-sm text-[#55645E]">
          <span className="font-medium text-[#12251F]">
            {last.direction === "in" ? "They said" : "You said"}
          </span>{" "}
          &ldquo;{last.body}&rdquo;, {relativeDays(last.sent_at)}
        </p>
      )}

      <Link
        href={`/dashboard/leads/${lead.id}`}
        className="mt-4 inline-block rounded-full bg-[#1F7A5C] px-4 py-2 text-sm font-medium text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1F7A5C]"
      >
        Open chat
      </Link>
    </li>
  );
}
