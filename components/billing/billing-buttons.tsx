"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CreditCard, Loader2, RefreshCw, Settings2 } from "lucide-react";
import { toast } from "sonner";
import { openBillingPortal, startCheckout } from "@/app/dashboard/billing/actions";
import { Button } from "@/components/ui/button";

// Both actions end in a redirect to a Stripe-hosted page, so on success nothing comes back here.
// Only a failure returns, as an error to show.
function useStripeAction(action: () => Promise<{ error?: string }>) {
  const [pending, start] = useTransition();
  const run = () =>
    start(async () => {
      const res = await action();
      if (res?.error) toast.error(res.error);
    });
  return { pending, run };
}

export function SubscribeButton({
  configured,
  label = "Subscribe",
  size = "lg",
}: {
  configured: boolean;
  label?: string;
  size?: "default" | "lg";
}) {
  const { pending, run } = useStripeAction(startCheckout);
  return (
    <Button onClick={run} disabled={pending || !configured} size={size} className="w-full sm:w-fit">
      {pending ? <Loader2 className="animate-spin" /> : <CreditCard />}
      {pending ? "Opening secure checkout…" : label}
    </Button>
  );
}

export function ManageBillingButton({
  configured,
  variant = "outline",
  label = "Manage billing",
}: {
  configured: boolean;
  variant?: "default" | "outline";
  label?: string;
}) {
  const { pending, run } = useStripeAction(openBillingPortal);
  return (
    <Button onClick={run} disabled={pending || !configured} variant={variant} size="lg" className="w-full sm:w-fit">
      {pending ? <Loader2 className="animate-spin" /> : <Settings2 />}
      {pending ? "Opening billing portal…" : label}
    </Button>
  );
}

const CHECKS = 8;
const EVERY_MS = 2500;

/**
 * Shown when the owner came back from checkout but the payment is not on file yet. The payment
 * itself is fine; our record of it is a few seconds behind. Re-check quietly instead of leaving
 * "Trial ended" on screen next to a "thank you", and only ask for a manual refresh if it really
 * is taking longer than usual.
 */
export function ConfirmingPayment() {
  const router = useRouter();
  const [checks, setChecks] = useState(0);
  const gaveUp = checks >= CHECKS;

  useEffect(() => {
    if (gaveUp) return;
    const t = setTimeout(() => {
      router.refresh();
      setChecks((n) => n + 1);
    }, EVERY_MS);
    return () => clearTimeout(t);
  }, [checks, gaveUp, router]);

  return (
    <div role="status" className="flex items-start gap-3 rounded-2xl bg-info p-4 text-info-foreground">
      {gaveUp ? (
        <RefreshCw className="mt-0.5 size-5 shrink-0" aria-hidden />
      ) : (
        <Loader2 className="mt-0.5 size-5 shrink-0 animate-spin" aria-hidden />
      )}
      <div className="flex-1">
        <p className="font-semibold">{gaveUp ? "This is taking longer than usual" : "Confirming your payment…"}</p>
        <p className="mt-0.5 text-sm">
          {gaveUp
            ? "Your payment went through, but it hasn't shown up here yet. Refresh in a minute. You have not been charged twice."
            : "Your payment went through. This page will update in a moment."}
        </p>
        {gaveUp && (
          <Button variant="outline" size="sm" className="mt-3" onClick={() => router.refresh()}>
            <RefreshCw /> Refresh now
          </Button>
        )}
      </div>
    </div>
  );
}
