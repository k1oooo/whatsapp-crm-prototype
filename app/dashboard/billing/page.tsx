import { redirect } from "next/navigation";
import { BillingActions } from "@/components/BillingActions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getOrCreateBusiness } from "@/lib/business";
import { stripeConfigured } from "@/lib/stripe";
import { isSubscriptionActive, trialDaysLeft, type SubscriptionInfo } from "@/lib/subscriptions";
import { createClient } from "@/lib/supabase/server";

const dateFmt = new Intl.DateTimeFormat("en-MY", { day: "numeric", month: "long", year: "numeric" });
interface Summary {
  title: string;
  detail: string;
  tone: string;
}

function summarise(sub: (SubscriptionInfo & { stripe_customer_id: string | null }) | null): Summary {
  if (!sub) {
    return {
      title: "No subscription yet",
      detail: "Subscribe to let the assistant reply to your customers.",
      tone: "bg-warning text-warning-foreground",
    };
  }
  const active = isSubscriptionActive(sub);
  switch (sub.status) {
    case "active":
      return {
        title: "Active",
        detail: sub.current_period_end
          ? `Your subscription renews on ${dateFmt.format(new Date(sub.current_period_end))}.`
          : "Your subscription is active.",
        tone: "bg-success text-success-foreground",
      };
    case "trialing": {
      if (!active) {
        return {
          title: "Trial ended",
          detail: "Your free trial is over. Subscribe to turn the assistant back on.",
          tone: "bg-warning text-warning-foreground",
        };
      }
      const left = trialDaysLeft(sub);
      return {
        title: "Free trial",
        detail:
          left === null
            ? "You are on a free trial."
            : `${left} ${left === 1 ? "day" : "days"} left (ends ${dateFmt.format(new Date(sub.trial_ends_at!))}). No card needed until you subscribe.`,
        tone: "bg-info text-info-foreground",
      };
    }
    case "past_due":
      return {
        title: "Payment failed",
        detail: "Your last payment did not go through. Update your card to turn the assistant back on.",
        tone: "bg-warning text-warning-foreground",
      };
    case "canceled":
      return {
        title: "Cancelled",
        detail: "Your subscription was cancelled. Subscribe again to turn the assistant back on.",
        tone: "bg-warning text-warning-foreground",
      };
    default:
      return {
        title: "Not active",
        detail: "Checkout was not completed. Subscribe to turn the assistant on.",
        tone: "bg-warning text-warning-foreground",
      };
  }
}

export default async function BillingPage({ searchParams }: { searchParams: Promise<{ checkout?: string }> }) {
  const { checkout } = await searchParams;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const business = await getOrCreateBusiness<{ id: string }>(supabase, user, "id");
  if (!business) redirect("/dashboard");

  const { data: subRow } = await supabase
    .from("subscriptions")
    .select("status, trial_ends_at, current_period_end, stripe_customer_id")
    .eq("business_id", business.id)
    .maybeSingle();
  const sub = (subRow as (SubscriptionInfo & { stripe_customer_id: string | null }) | null) ?? null;

  const summary = summarise(sub);
  // Someone with a live Stripe subscription (paying, or behind on a payment) manages it in the
  // portal instead. A second checkout on top would bill them twice.
  const canSubscribe = !sub || (sub.status !== "active" && sub.status !== "past_due");

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 p-4 sm:p-6">
      <header>
        <h1 className="font-heading text-3xl font-bold">Billing</h1>
        <p className="mt-2 text-lg text-muted-foreground">
          The assistant replies to customers while your subscription is active.
        </p>
      </header>

      {checkout === "success" && (
        <p className="rounded-lg bg-success px-4 py-3 text-success-foreground">
          Thank you! Your payment went through. It can take a few seconds to show up here, so refresh if the
          status has not changed yet.
        </p>
      )}
      {checkout === "cancelled" && (
        <p className="rounded-lg bg-info px-4 py-3 text-info-foreground">
          Checkout was cancelled. You have not been charged.
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-3 text-2xl">
            Your plan
            <span className={`rounded-full px-3 py-1 text-sm font-semibold ${summary.tone}`}>{summary.title}</span>
          </CardTitle>
          <CardDescription className="text-base">{summary.detail}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {!stripeConfigured() && (
            <p className="rounded-lg bg-warning px-4 py-3 text-sm text-warning-foreground">
              Billing is not set up on this deployment yet. Set STRIPE_SECRET_KEY and STRIPE_PRICE_ID to turn it on.
            </p>
          )}
          <BillingActions
            hasCustomer={!!sub?.stripe_customer_id}
            canSubscribe={canSubscribe}
            configured={stripeConfigured()}
          />
          <p className="text-sm text-muted-foreground">
            While your subscription is not active, customer messages still arrive and you can answer them yourself,
            but the assistant will not reply, draft, or send follow-ups.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
