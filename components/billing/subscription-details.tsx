import {
  AlertTriangle,
  CalendarClock,
  CreditCard,
  ExternalLink,
  FileText,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import type { PlanKind } from "@/lib/billing-summary";
import {
  cardExpiresSoon,
  cardExpiry,
  cardLabel,
  type BillingDetails,
} from "@/lib/billing-details";
import type { PlanPrice } from "@/lib/plan";

const dateFmt = new Intl.DateTimeFormat("en-MY", {
  day: "numeric",
  month: "short",
  year: "numeric",
});
const fmt = (iso: string | null | undefined) =>
  iso ? dateFmt.format(new Date(iso)) : null;

const TRIAL_MS = 14 * 86_400_000;

interface Row {
  label: string;
  value: React.ReactNode;
  hint?: string;
}

function Details({ rows }: { rows: Row[] }) {
  return (
    <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
      {rows.map((r) => (
        <div key={r.label} className="min-w-0">
          <dt className="text-xs md:text-sm text-muted-foreground">
            {r.label}
          </dt>
          <dd className="mt-0.5 text-sm md:text-base font-semibold break-words">
            {r.value}
          </dd>
          {r.hint && (
            <p className="mt-0.5 text-xs text-muted-foreground">{r.hint}</p>
          )}
        </div>
      ))}
    </dl>
  );
}

function SectionTitle({
  icon: Icon,
  children,
}: {
  icon: LucideIcon;
  children: React.ReactNode;
}) {
  return (
    <h2 className="flex items-center gap-2 font-heading text-base md:text-lg font-bold">
      <Icon className="size-4 md:size-5 text-primary" aria-hidden />
      {children}
    </h2>
  );
}

const INVOICE_BADGE = {
  paid: { label: "Paid", variant: "success" },
  open: { label: "Unpaid", variant: "warning" },
  uncollectible: { label: "Failed", variant: "warning" },
  void: { label: "Void", variant: "muted" },
} as const;

export function SubscriptionDetails({
  kind,
  price,
  trialEndsAt,
  currentPeriodEnd,
  details,
}: {
  kind: PlanKind;
  price: PlanPrice | null;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  details: BillingDetails | null;
}) {
  const priceText = price ? `${price.amount} / ${price.interval}` : "Not available";
  const paying = kind === "active" || kind === "past_due";
  const trialing = kind === "trial" || kind === "trial_ended";
  const ending = paying && details?.endsOn;

  const rows: Row[] = [{ label: "Plan", value: "Standard" }];

  if (paying) {
    rows.push({ label: "Price", value: priceText });
    rows.push({
      label: "Status",
      value:
        kind === "past_due"
          ? "Payment failed"
          : ending
            ? "Cancelled, active until the end of this period"
            : "Active",
    });
    if (details?.startedOn)
      rows.push({ label: "Subscribed since", value: fmt(details.startedOn) });
    rows.push({
      label: ending ? "Access ends" : "Next payment",
      value: fmt(ending ? details?.endsOn : currentPeriodEnd) ?? "Not available",
      hint:
        !ending && details?.nextAmount
          ? `${details.nextAmount}, charged to your card`
          : undefined,
    });
  } else if (trialing) {
    rows.push({ label: "Price after trial", value: priceText });
    if (trialEndsAt) {
      rows.push({
        label: "Trial started",
        value: fmt(new Date(new Date(trialEndsAt).getTime() - TRIAL_MS).toISOString()),
      });
      rows.push({
        label: kind === "trial" ? "Trial ends" : "Trial ended",
        value: fmt(trialEndsAt),
      });
    }
    rows.push({
      label: "Billing",
      value: "No card on file",
      hint: "You are only charged when you subscribe.",
    });
  } else {
    rows.push({ label: "Price", value: priceText });
    rows.push({ label: "Billing", value: "No active subscription" });
  }

  const card = details?.card;

  return (
    <>
      {ending && (
        <div
          role="status"
          className="flex items-start gap-3 rounded-2xl bg-warning p-4 text-warning-foreground"
        >
          <CalendarClock className="mt-0.5 size-5 shrink-0" aria-hidden />
          <div>
            <p className="font-semibold">
              Your plan ends on {fmt(details?.endsOn)}
            </p>
            <p className="mt-0.5 text-sm">
              The assistant keeps working until then. Use Manage billing to
              resume your plan before it ends.
            </p>
          </div>
        </div>
      )}

      <Card className="flex flex-col gap-4 p-4 sm:p-6">
        <SectionTitle icon={FileText}>Subscription details</SectionTitle>
        <Details rows={rows} />
      </Card>

      {paying && (
        <Card className="flex flex-col gap-4 p-4 sm:p-6">
          <SectionTitle icon={CreditCard}>Payment method</SectionTitle>
          {card ? (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <p className="text-sm md:text-base font-semibold">
                {cardLabel(card)}
              </p>
              <p className="text-xs md:text-sm text-muted-foreground">
                Expires {cardExpiry(card)}
              </p>
              {cardExpiresSoon(card) && (
                <Badge variant="warning">
                  <AlertTriangle className="size-3" aria-hidden /> Update soon
                </Badge>
              )}
            </div>
          ) : details ? (
            <p className="text-sm text-muted-foreground">
              No card on file yet. Open Manage billing to add one.
            </p>
          ) : (
            <p className="flex items-start gap-2 text-sm text-muted-foreground">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning-foreground" aria-hidden />
              We couldn&apos;t reach Stripe just now, so your card and
              invoices aren&apos;t shown below. Your subscription itself is
              unaffected — open Manage billing to see them directly, or
              reload this page to try again.
            </p>
          )}
        </Card>
      )}

      {paying && details && (
        <Card className="flex flex-col gap-3 p-4 sm:p-6">
          <SectionTitle icon={FileText}>Invoices</SectionTitle>
          {details.invoices.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Your invoices will appear here after your first payment.
            </p>
          ) : (
            <ul className="divide-y">
              {details.invoices.map((inv) => {
                const badge = INVOICE_BADGE[inv.status];
                return (
                  <li
                    key={inv.id}
                    className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0"
                  >
                    <div className="min-w-0">
                      <p className="text-sm md:text-base font-semibold">
                        {fmt(inv.date)}
                      </p>
                      {inv.number && (
                        <p className="text-xs text-muted-foreground">
                          {inv.number}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm md:text-base font-semibold">
                        {inv.amount}
                      </span>
                      <Badge variant={badge.variant}>{badge.label}</Badge>
                      {inv.url && (
                        <a
                          href={inv.url}
                          target="_blank"
                          rel="noreferrer"
                          aria-label={`Open invoice ${inv.number ?? fmt(inv.date)}`}
                          className="flex size-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                        >
                          <ExternalLink className="size-4" aria-hidden />
                        </a>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      )}
    </>
  );
}
