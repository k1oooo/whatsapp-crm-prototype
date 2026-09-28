"use client";

import { useTransition } from "react";
import { CreditCard, Loader2, Settings2 } from "lucide-react";
import { toast } from "sonner";
import { openBillingPortal, startCheckout } from "@/app/dashboard/billing/actions";
import { Button } from "@/components/ui/button";

// Both actions end in a redirect to Stripe's own hosted page, so on success nothing comes back
// here. Only a failure returns, as an error to show.
export function BillingActions({
  hasCustomer,
  canSubscribe,
  configured,
}: {
  hasCustomer: boolean;
  canSubscribe: boolean;
  configured: boolean;
}) {
  const [pending, start] = useTransition();

  function run(action: () => Promise<{ error?: string }>) {
    start(async () => {
      const res = await action();
      if (res?.error) toast.error(res.error);
    });
  }

  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      {canSubscribe && (
        <Button onClick={() => run(startCheckout)} disabled={pending || !configured} className="sm:w-fit">
          {pending ? <Loader2 className="animate-spin" /> : <CreditCard />}
          Subscribe
        </Button>
      )}
      {hasCustomer && (
        <Button
          variant="outline"
          onClick={() => run(openBillingPortal)}
          disabled={pending || !configured}
          className="sm:w-fit"
        >
          {pending ? <Loader2 className="animate-spin" /> : <Settings2 />}
          Manage billing
        </Button>
      )}
    </div>
  );
}
