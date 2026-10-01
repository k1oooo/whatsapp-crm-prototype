import { CircleCheck, Clock, Sparkles } from "lucide-react";
import { ReasonIcon } from "@/components/reason-icon";
import { Badge } from "@/components/ui/badge";
import { ORDER_LABEL, REASON_LABEL, STAGE_DOT, STAGE_LABEL, type Stage } from "@/lib/leads";

// One vocabulary for where a customer stands, used by the inbox and the pipeline so the same
// state always looks and reads the same.
//
//   Needs you            warning   you must act
//   Draft ready          info      you can act
//   Waiting for payment  outline   the customer must act
//   Paid                 success   done
//   Quiet                muted     nothing is happening

export function NeedsYouBadge({ reason, withPrefix = false }: { reason: string | null; withPrefix?: boolean }) {
  const why = reason ? (REASON_LABEL[reason] ?? reason) : null;
  return (
    <Badge variant="warning">
      <ReasonIcon reason={reason} />
      {withPrefix ? `Needs you${why ? `: ${why}` : ""}` : (why ?? "you said you would check")}
    </Badge>
  );
}

export function DraftBadge() {
  return (
    <Badge variant="info">
      <Sparkles />
      Draft ready
    </Badge>
  );
}

export function WaitingPaymentBadge() {
  return <Badge variant="outline">{ORDER_LABEL.confirmed}</Badge>;
}

export function PaidBadge() {
  return (
    <Badge variant="success">
      <CircleCheck />
      {ORDER_LABEL.paid}
    </Badge>
  );
}

export function QuietBadge() {
  return (
    <Badge variant="muted">
      <Clock />
      Quiet
    </Badge>
  );
}

export function StageBadge({ stage }: { stage: Stage }) {
  return (
    <Badge variant="muted">
      <span aria-hidden className="size-1.5 rounded-full" style={{ background: STAGE_DOT[stage] }} />
      {STAGE_LABEL[stage]}
    </Badge>
  );
}

/** The single most important status for a chat row. Priority follows the list above. */
export function LeadStatusBadge({
  needsYou,
  reason,
  hasDraft,
  orderStatus,
  cold,
  stage,
}: {
  needsYou: boolean;
  reason: string | null;
  hasDraft: boolean;
  orderStatus: string | null;
  cold: boolean;
  stage: Stage;
}) {
  if (needsYou) return <NeedsYouBadge reason={reason} />;
  if (hasDraft) return <DraftBadge />;
  if (orderStatus === "paid") return <PaidBadge />;
  if (orderStatus === "confirmed") return <WaitingPaymentBadge />;
  if (cold) return <QuietBadge />;
  return <StageBadge stage={stage} />;
}
