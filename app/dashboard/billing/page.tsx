import { redirect } from "next/navigation";
import {
  AlertTriangle,
  BadgeCheck,
  BookOpen,
  Bot,
  CalendarClock,
  Check,
  CircleCheck,
  Hourglass,
  Lock,
  Megaphone,
  MessageSquareText,
  ShoppingBag,
  type LucideIcon,
} from "lucide-react";
import {
  ConfirmingPayment,
  ManageBillingButton,
  SubscribeButton,
} from "@/components/billing/billing-buttons";
import { SubscriptionDetails } from "@/components/billing/subscription-details";
import { Card } from "@/components/ui/card";
import { getBillingDetails } from "@/lib/billing-details";
import {
  summarisePlan,
  TRIAL_DAYS,
  type PlanKind,
} from "@/lib/billing-summary";
import { getOrCreateBusiness } from "@/lib/business";
import { getPlanPrice } from "@/lib/plan";
import { stripeConfigured } from "@/lib/stripe";
import type { SubscriptionInfo } from "@/lib/subscriptions";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

const TONE: Record<PlanKind, { icon: LucideIcon; ring: string; chip: string }> =
  {
    none: {
      icon: Hourglass,
      ring: "bg-warning text-warning-foreground",
      chip: "bg-warning text-warning-foreground",
    },
    trial: {
      icon: Hourglass,
      ring: "bg-info text-info-foreground",
      chip: "bg-info text-info-foreground",
    },
    trial_ended: {
      icon: AlertTriangle,
      ring: "bg-warning text-warning-foreground",
      chip: "bg-warning text-warning-foreground",
    },
    active: {
      icon: BadgeCheck,
      ring: "bg-success text-success-foreground",
      chip: "bg-success text-success-foreground",
    },
    past_due: {
      icon: AlertTriangle,
      ring: "bg-warning text-warning-foreground",
      chip: "bg-warning text-warning-foreground",
    },
    canceled: {
      icon: AlertTriangle,
      ring: "bg-warning text-warning-foreground",
      chip: "bg-warning text-warning-foreground",
    },
    incomplete: {
      icon: AlertTriangle,
      ring: "bg-warning text-warning-foreground",
      chip: "bg-warning text-warning-foreground",
    },
  };

const CHIP_LABEL: Record<PlanKind, string> = {
  none: "No plan",
  trial: "Free trial",
  trial_ended: "Trial ended",
  active: "Active",
  past_due: "Payment failed",
  canceled: "Cancelled",
  incomplete: "Not started",
};

const INCLUDED: { icon: LucideIcon; title: string; body: string }[] = [
  {
    icon: MessageSquareText,
    title: "Answers customers for you",
    body: "Replies in your tone, in the customer's language, any hour.",
  },
  {
    icon: ShoppingBag,
    title: "Takes orders from start to finish",
    body: "Collects details, confirms the order, sends your payment details.",
  },
  {
    icon: Bot,
    title: "You choose how much it does alone",
    body: "Send automatically, or have it draft and approve every reply yourself.",
  },
  {
    icon: Megaphone,
    title: "After-sale follow-ups",
    body: "Reorder reminders and feedback requests after each order.",
  },
  {
    icon: BookOpen,
    title: "Knows your business",
    body: "Answers menu, price and location questions from your knowledge base.",
  },
];

const KEEPS_WORKING = [
  "Customer messages still arrive in your inbox",
  "You can reply yourself, any time",
  "Your pipeline and knowledge base stay as they are",
  "Customers who send STOP are still respected",
];
const PAUSES = [
  "AI replies and drafts",
  "Reading chats to fill in lead details",
  "Automatic follow-ups (they wait, and send once you're back)",
];

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ checkout?: string; confirm?: string }>;
}) {
  const { checkout, confirm } = await searchParams;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const business = await getOrCreateBusiness<{ id: string }>(
    supabase,
    user,
    "id",
  );
  if (!business) redirect("/dashboard");

  const { data: subRow } = await supabase
    .from("subscriptions")
    .select(
      "status, trial_ends_at, current_period_end, stripe_customer_id, stripe_subscription_id",
    )
    .eq("business_id", business.id)
    .maybeSingle();
  const sub =
    (subRow as
      | (SubscriptionInfo & {
          stripe_customer_id: string | null;
          stripe_subscription_id: string | null;
        })
      | null) ?? null;

  const configured = stripeConfigured();
  const plan = summarisePlan(sub);
  const price = await getPlanPrice();
  const details = await getBillingDetails(
    sub?.stripe_subscription_id ?? null,
    sub?.stripe_customer_id ?? null,
  );
  const tone = TONE[plan.kind];
  const Icon = tone.icon;

  const hasLiveSubscription =
    sub?.status === "active" || sub?.status === "past_due";
  const canSubscribe = !hasLiveSubscription;
  const confirming = checkout === "success" && plan.kind !== "active";

  return (
    <div className="flex-1 min-h-0 w-full overflow-y-auto overflow-x-hidden scroll-stable">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-4 pb-24 md:gap-6 sm:p-6 lg:p-8">
        <header>
          <h1 className="font-heading text-2xl md:text-3xl font-bold">
            Billing
          </h1>
          <p className="mt-1 md:mt-2 text-sm md:text-lg text-muted-foreground">
            Your plan, and what the assistant does while it&apos;s active.
          </p>
        </header>

        {confirming && <ConfirmingPayment key={confirm ?? "now"} />}
        {checkout === "success" && plan.kind === "active" && (
          <div
            role="status"
            className="flex items-start gap-3 rounded-2xl bg-success p-4 text-success-foreground"
          >
            <CircleCheck className="mt-0.5 size-5 shrink-0" aria-hidden />
            <div>
              <p className="font-semibold">Payment received. Thank you!</p>
              <p className="mt-0.5 text-sm">
                The assistant is on and answering your customers again.
              </p>
            </div>
          </div>
        )}
        {checkout === "cancelled" && (
          <div
            role="status"
            className="rounded-2xl bg-info p-4 text-info-foreground"
          >
            <p className="font-semibold">Checkout cancelled</p>
            <p className="mt-0.5 text-sm">
              You haven&apos;t been charged. Subscribe whenever you&apos;re
              ready.
            </p>
          </div>
        )}
        {!configured && (
          <div className="rounded-2xl bg-warning p-4 text-xs md:text-sm text-warning-foreground">
            Billing isn&apos;t set up on this deployment yet. Set
            STRIPE_SECRET_KEY and STRIPE_PRICE_ID to turn it on. Your trial and
            the pause still work.
          </div>
        )}

        {/* Where you stand */}
        <Card className="overflow-hidden">
          <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-start sm:p-6">
            <span
              className={cn(
                "flex size-10 md:size-12 shrink-0 items-center justify-center rounded-full",
                tone.ring,
              )}
            >
              <Icon className="size-5 md:size-6" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-xl md:text-2xl font-bold leading-tight">
                  {plan.title}
                </h2>
                <span
                  className={cn(
                    "rounded-full px-2.5 py-0.5 text-xs font-semibold",
                    tone.chip,
                  )}
                >
                  {CHIP_LABEL[plan.kind]}
                </span>
              </div>
              <p className="mt-1 text-sm md:text-base text-muted-foreground">
                {plan.detail}
              </p>

              {plan.trialUsed !== undefined && (
                <div className="mt-4 max-w-md">
                  <div
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={TRIAL_DAYS}
                    aria-valuenow={plan.trialUsed}
                    aria-label="Free trial used"
                    className="h-2.5 overflow-hidden rounded-full bg-muted"
                  >
                    <div
                      className={cn(
                        "h-full rounded-full transition-all",
                        plan.kind === "trial_ended"
                          ? "bg-warning-foreground/60"
                          : "bg-primary",
                      )}
                      style={{
                        width: `${(plan.trialUsed / TRIAL_DAYS) * 100}%`,
                      }}
                    />
                  </div>
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    Day{" "}
                    {Math.min(
                      plan.trialUsed + (plan.kind === "trial" ? 1 : 0),
                      TRIAL_DAYS,
                    )}{" "}
                    of {TRIAL_DAYS}
                  </p>
                </div>
              )}

              {hasLiveSubscription && (
                <div className="mt-4 flex flex-col gap-3">
                  <div className="flex flex-col gap-3 sm:flex-row">
                    <ManageBillingButton
                      configured={configured}
                      variant={plan.kind === "past_due" ? "default" : "outline"}
                      label={
                        plan.kind === "past_due"
                          ? "Update payment method"
                          : "Manage billing"
                      }
                    />
                  </div>
                  <p className="text-xs md:text-sm text-muted-foreground">
                    Change your card, see invoices, or cancel, on Stripe&apos;s
                    secure billing page.
                  </p>
                </div>
              )}
            </div>
          </div>
        </Card>

        <SubscriptionDetails
          kind={plan.kind}
          price={price}
          trialEndsAt={sub?.trial_ends_at ?? null}
          currentPeriodEnd={sub?.current_period_end ?? null}
          details={details}
        />

        {/* The offer */}
        {canSubscribe && (
          <Card className="overflow-hidden border-primary/30">
            <div className="grid gap-6 p-4 sm:p-6 md:grid-cols-[1fr_auto]">
              <div>
                <p className="text-xs md:text-sm font-semibold uppercase tracking-wide text-primary">
                  Standard plan
                </p>
                {price ? (
                  <p className="mt-1 flex items-baseline gap-1.5">
                    <span className="font-heading text-3xl md:text-4xl font-bold">
                      {price.amount}
                    </span>
                    <span className="text-base md:text-lg text-muted-foreground">
                      / {price.interval}
                    </span>
                  </p>
                ) : (
                  <p className="mt-1 text-base md:text-lg text-muted-foreground">
                    One simple plan, everything included.
                  </p>
                )}
                <ul className="mt-4 grid gap-3 sm:grid-cols-2">
                  {INCLUDED.map(({ icon: ItemIcon, title, body }) => (
                    <li key={title} className="flex gap-3">
                      <span className="mt-0.5 flex size-7 md:size-8 shrink-0 items-center justify-center rounded-full bg-secondary text-secondary-foreground">
                        <ItemIcon className="size-3.5 md:size-4" aria-hidden />
                      </span>
                      <span>
                        <span className="block text-sm md:text-base font-medium leading-snug">
                          {title}
                        </span>
                        <span className="block text-xs md:text-sm text-muted-foreground">
                          {body}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="flex flex-col justify-end gap-3 md:w-64">
                <SubscribeButton
                  configured={configured}
                  label={plan.kind === "trial" ? "Subscribe now" : "Subscribe"}
                />
                <ul className="flex flex-col gap-1.5 text-xs md:text-sm text-muted-foreground">
                  <li className="flex items-center gap-2">
                    <Lock className="size-3.5 shrink-0" aria-hidden /> Secure
                    payment by Stripe
                  </li>
                  <li className="flex items-center gap-2">
                    <CalendarClock className="size-3.5 shrink-0" aria-hidden />{" "}
                    Cancel any time
                  </li>
                </ul>
                {plan.kind === "trial" && (
                  <p className="text-[11px] md:text-xs text-muted-foreground">
                    You&apos;ll be charged when you subscribe. It doesn&apos;t
                    add to your remaining trial days.
                  </p>
                )}
              </div>
            </div>
          </Card>
        )}

        {/* Reassurance */}
        <details
          className="group rounded-xl border bg-card open:shadow-xs"
          open={!plan.assistantOn}
        >
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4 text-sm md:text-base font-semibold sm:px-6 [&::-webkit-details-marker]:hidden">
            <span>What happens if your plan isn&apos;t active?</span>
            <span
              aria-hidden
              className="text-muted-foreground transition-transform group-open:rotate-180"
            >
              ⌄
            </span>
          </summary>
          <div className="grid gap-6 px-4 pb-4 sm:grid-cols-2 sm:px-6 sm:pb-6">
            <div>
              <p className="mb-2 text-xs md:text-sm font-semibold text-success-foreground">
                Keeps working
              </p>
              <ul className="flex flex-col gap-2 text-xs md:text-sm">
                {KEEPS_WORKING.map((t) => (
                  <li key={t} className="flex gap-2">
                    <Check
                      className="mt-0.5 size-4 shrink-0 text-success-foreground"
                      aria-hidden
                    />
                    {t}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="mb-2 text-xs md:text-sm font-semibold text-warning-foreground">
                Pauses
              </p>
              <ul className="flex flex-col gap-2 text-xs md:text-sm">
                {PAUSES.map((t) => (
                  <li key={t} className="flex gap-2">
                    <Hourglass
                      className="mt-0.5 size-4 shrink-0 text-warning-foreground"
                      aria-hidden
                    />
                    {t}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </details>
      </div>
    </div>
  );
}
