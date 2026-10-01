import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  CreditCard,
  MessageCircleWarning,
  type LucideIcon,
} from "lucide-react";
import { MobileNav } from "@/components/app/nav";
import { MobileTopBar } from "@/components/app/mobile-top-bar";
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

  const testMode =
    !!business.wa_phone_number_id && sendMode(business.wa_access_token) === "dry";

  // One banner at a time, the most urgent first. Everything here needs the owner to do
  // something, so a banner that is always on (like "Live") would only teach people to ignore them.
  let banner: { href: string; tone: string; icon: LucideIcon; text: string } | null = null;
  if (!subscriptionActive) {
    banner = {
      href: "/dashboard/billing",
      tone: "bg-warning text-warning-foreground",
      icon: CreditCard,
      text: `The assistant is paused. ${subscriptionBlockedNote(subscription)}`,
    };
  } else if (!business.wa_phone_number_id) {
    banner = {
      href: "/dashboard/settings/whatsapp",
      tone: "bg-warning text-warning-foreground",
      icon: MessageCircleWarning,
      text: "Connect WhatsApp to start receiving customer messages",
    };
  } else if (trialDaysLeftCount !== null && trialDaysLeftCount <= 3) {
    banner = {
      href: "/dashboard/billing",
      tone: "bg-info text-info-foreground",
      icon: CreditCard,
      text: `Your free trial ends in ${trialDaysLeftCount} ${trialDaysLeftCount === 1 ? "day" : "days"}. Subscribe to keep the assistant on.`,
    };
  }

  return (
    <div className="fixed inset-0 flex overflow-clip">
      <Sidebar
        businessName={business.name}
        autoReply={business.auto_reply}
        needsYou={needsYou}
        defaultCollapsed={sidebarCollapsed}
        testMode={testMode}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <MobileTopBar
          businessName={business.name}
          autoReply={business.auto_reply}
          testMode={testMode}
        />
        {banner && (
          <Link
            href={banner.href}
            className={`flex shrink-0 items-center justify-center gap-2 px-4 py-2.5 text-center text-sm leading-snug font-medium hover:underline ${banner.tone}`}
          >
            <banner.icon className="size-4 shrink-0" aria-hidden />
            <span>{banner.text}</span>
          </Link>
        )}

        <main className="flex min-h-0 flex-1 flex-col">{children}</main>

        <MobileNav needsYou={needsYou} />
      </div>
    </div>
  );
}
