import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  CreditCard,
  FlaskConical,
  MessageCircleWarning,
  Radio,
} from "lucide-react";
import { MobileNav } from "@/components/app/nav";
import { Sidebar } from "@/components/app/sidebar";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import { getOrCreateBusiness } from "@/lib/business";
import { sendMode } from "@/lib/send";
import {
  isSubscriptionActive,
  subscriptionBlockedNote,
  trialDaysLeft,
  type SubscriptionInfo,
} from "@/lib/subscriptions";

const BUSINESS_COLUMNS =
  "id, name, auto_reply, cold_after_days, wa_phone_number_id, wa_access_token";

interface DashboardBusiness {
  id: string;
  name: string;
  auto_reply: boolean;
  cold_after_days: number;
  wa_phone_number_id: string | null;
  wa_access_token: string | null;
}

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const business = await getOrCreateBusiness<DashboardBusiness>(
    supabase,
    user,
    BUSINESS_COLUMNS,
  );

  if (!business) {
    return (
      <main className="flex min-h-dvh items-center justify-center p-4 md:p-6">
        <Card className="max-w-lg w-full">
          <CardHeader>
            <CardTitle className="text-xl md:text-2xl">
              Could not set up your business
            </CardTitle>
            <CardDescription className="text-sm md:text-base">
              Something went wrong creating your workspace. Refresh the page, or
              contact support if this keeps happening.
            </CardDescription>
          </CardHeader>
        </Card>
      </main>
    );
  }

  const { count: needsYouCount } = await supabase
    .from("leads")
    .select("id", { count: "exact", head: true })
    .eq("business_id", business.id)
    .eq("pending_decision", true);

  const needsYou = needsYouCount ?? 0;

  const { data: subRow } = await supabase
    .from("subscriptions")
    .select("status, trial_ends_at, current_period_end")
    .eq("business_id", business.id)
    .maybeSingle();
  const subscription = (subRow as SubscriptionInfo | null) ?? null;
  const subscriptionActive = isSubscriptionActive(subscription);
  const trialDaysLeftCount = trialDaysLeft(subscription);

  const sidebarCollapsed =
    (await cookies()).get("sidebar-collapsed")?.value === "1";

  return (
    <div className="fixed inset-0 flex overflow-clip">
      <Sidebar
        businessName={business.name}
        autoReply={business.auto_reply}
        needsYou={needsYou}
        defaultCollapsed={sidebarCollapsed}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        {!subscriptionActive && (
          <Link
            href="/dashboard/billing"
            className="flex shrink-0 items-center justify-center gap-1.5 md:gap-2 bg-warning p-2.5 md:px-4 md:py-2 text-center text-[11px] md:text-sm font-medium leading-tight text-warning-foreground hover:underline"
          >
            <CreditCard className="size-3.5 md:size-4 shrink-0" aria-hidden />
            <span>
              The assistant is paused. {subscriptionBlockedNote(subscription)}
            </span>
          </Link>
        )}
        {trialDaysLeftCount !== null && trialDaysLeftCount <= 3 && (
          <Link
            href="/dashboard/billing"
            className="flex shrink-0 items-center justify-center gap-1.5 md:gap-2 bg-info p-2.5 md:px-4 md:py-2 text-center text-[11px] md:text-sm font-medium leading-tight text-info-foreground hover:underline"
          >
            <CreditCard className="size-3.5 md:size-4 shrink-0" aria-hidden />
            <span>
              Your free trial ends in {trialDaysLeftCount}{" "}
              {trialDaysLeftCount === 1 ? "day" : "days"}. Subscribe to keep the
              assistant on.
            </span>
          </Link>
        )}
        {!business.wa_phone_number_id && (
          <Link
            href="/dashboard/settings/whatsapp"
            className="flex shrink-0 items-center justify-center gap-1.5 md:gap-2 bg-warning p-2.5 md:px-4 md:py-2 text-center text-[11px] md:text-sm font-medium leading-tight text-warning-foreground hover:underline"
          >
            <MessageCircleWarning
              className="size-3.5 md:size-4 shrink-0"
              aria-hidden
            />
            <span>Connect WhatsApp to start receiving customer messages</span>
          </Link>
        )}
        {business.wa_phone_number_id &&
          sendMode(business.wa_access_token) === "dry" && (
            <div className="flex shrink-0 items-center justify-center gap-1.5 md:gap-2 bg-info p-2.5 md:px-4 md:py-2 text-center text-[11px] md:text-sm font-medium leading-tight text-info-foreground">
              <FlaskConical
                className="size-3.5 md:size-4 shrink-0"
                aria-hidden
              />
              <span>
                Test mode: WhatsApp messages are not being sent to customers
              </span>
            </div>
          )}
        {business.wa_phone_number_id &&
          sendMode(business.wa_access_token) === "live" && (
            <div className="flex shrink-0 items-center justify-center gap-1.5 md:gap-2 bg-success p-2.5 md:px-4 md:py-2 text-center text-[11px] md:text-sm font-medium leading-tight text-success-foreground">
              <Radio className="size-3.5 md:size-4 shrink-0" aria-hidden />
              <span>
                Live: messages are being sent to real customers on WhatsApp
              </span>
            </div>
          )}

        <main className="min-h-0 flex-1 flex flex-col">{children}</main>

        <MobileNav needsYou={needsYou} />
      </div>
    </div>
  );
}
