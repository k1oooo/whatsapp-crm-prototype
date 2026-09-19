import Link from "next/link";
import { DraftPanel } from "@/components/DraftPanel";
import {
  daysSince,
  daysUntil,
  displayName,
  formatDeadline,
  lastTouch,
  owesReply,
  relativeDays,
  rm,
  type Draft,
  type LastMessage,
  type Lead,
} from "@/lib/leads";

export function ChaseItem({
  lead,
  draft,
  last,
}: {
  lead: Lead;
  draft?: Draft;
  last?: LastMessage;
}) {
  const quiet = daysSince(lastTouch(lead)) ?? 0;
  const left = lead.deadline ? daysUntil(lead.deadline) : null;
  const urgent = left !== null && left <= 3;
  const waitingOnYou = owesReply(lead, last);

  return (
    <li
      className={`rounded-xl border border-[#D8E0DA] border-l-4 bg-white p-4 sm:p-5 ${
        urgent ? "border-l-[#B26A00]" : "border-l-[#2F6DB5]"
      }`}
    >
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
        {waitingOnYou ? (
          <p className="rounded-full bg-[#FBEBD0] px-3 py-0.5 text-sm text-[#8A5000]">
            Waiting for your reply, {quiet} {quiet === 1 ? "day" : "days"}
          </p>
        ) : (
          <p className="rounded-full bg-[#E4EEF9] px-3 py-0.5 text-sm text-[#2F6DB5]">
            Quiet {quiet} {quiet === 1 ? "day" : "days"}
          </p>
        )}
      </div>

      <p className="mt-2">{lead.need ?? "No details yet"}</p>
      <p className="mt-1 text-[#55645E]">
        {[
          lead.quoted_price_myr ? `You quoted ${rm(lead.quoted_price_myr)}` : null,
          lead.budget_myr && !lead.quoted_price_myr ? `Budget ${rm(lead.budget_myr)}` : null,
          lead.deadline ? `Needed by ${formatDeadline(lead.deadline)}` : null,
        ]
          .filter(Boolean)
          .join(", ")}
      </p>
      {urgent && left !== null && (
        <p className="mt-1 text-sm font-medium text-[#B26A00]">
          {left < 0
            ? "Deadline has passed"
            : left === 0
              ? "Deadline is today"
              : `Deadline in ${left} ${left === 1 ? "day" : "days"}`}
        </p>
      )}

      {last?.body && (
        <p className="mt-3 max-w-prose border-l-2 border-[#D8E0DA] pl-3 text-sm text-[#55645E]">
          <span className="font-medium text-[#12251F]">
            {last.direction === "in" ? "They said" : "You said"}
          </span>{" "}
          &ldquo;{last.body}&rdquo;, {relativeDays(last.sent_at)}
        </p>
      )}

      <div className="mt-4">
        <DraftPanel lead={lead} draft={draft} />
      </div>
    </li>
  );
}
