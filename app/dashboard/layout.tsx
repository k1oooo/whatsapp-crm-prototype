import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { CreditCard, FlaskConical, MessageCircleWarning, Radio } from "lucide-react";
import { DashboardFrame } from "@/components/app/dashboard-frame";
import { MobileNav } from "@/components/app/nav";
import { Sidebar } from "@/components/app/sidebar";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import { getOrCreateBusiness } from "@/lib/business";
import { LEAD_COLUMNS, displayName, isCold, type ChatSummary, type Lead } from "@/lib/leads";
import { sendMode } from "@/lib/send";
import { isSubscriptionActive, subscriptionBlockedNote, trialDaysLeft, type SubscriptionInfo } from "@/lib/subscriptions";

const BUSINESS_COLUMNS = "id, name, auto_reply, cold_after_days, wa_phone_number_id, wa_access_token";

interface DashboardBusiness {
  id: string;
  name: string;
  auto_reply: boolean;
  cold_after_days: number;
  wa_phone_number_id: string | null;
  wa_access_token: string | null;
}

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const business = await getOrCreateBusiness<DashboardBusiness>(supabase, user, BUSINESS_COLUMNS);

  if (!business) {
    return (
      <main className="flex min-h-dvh items-center justify-center p-6">
        <Card className="max-w-lg">
          <CardHeader>
            <CardTitle className="text-2xl">Could not set up your business</CardTitle>
            <CardDescription>
              Something went wrong creating your workspace. Refresh the page, or contact support
              if this keeps happening.
            </CardDescription>
          </CardHeader>
        </Card>
      </main>
    );
  }

  const { data: leadRows } = await supabase
    .from("leads")
    .select(LEAD_COLUMNS)
    .eq("business_id", business.id)
    .order("last_message_at", { ascending: false, nullsFirst: false });
  const leads = (leadRows ?? []) as unknown as Lead[];

  // The newest message in each chat, for the preview line in the list.
  const { data: msgRows } = await supabase
    .from("messages")
    .select("lead_id, direction, body, sent_at, source")
    .eq("business_id", business.id)
    .order("sent_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(600);
  const last = new Map<string, { direction: "in" | "out"; body: string | null; sent_at: string; source: string | null }>();
  for (const m of msgRows ?? []) if (!last.has(m.lead_id)) last.set(m.lead_id, m);

  const { data: subRow } = await supabase
    .from("subscriptions")
    .select("status, trial_ends_at, current_period_end")
    .eq("business_id", business.id)
    .maybeSingle();
  const subscription = (subRow as SubscriptionInfo | null) ?? null;
  const subscriptionActive = isSubscriptionActive(subscription);
  // Warn a few days ahead, only for a trial nobody has converted, so the pause is never a surprise.
  const trialDaysLeftCount = trialDaysLeft(subscription);

  // Which chats have a drafted reply waiting for approval (reply_mode "approve"). Harmless to
  // always look: no rows exist at all while reply_mode is "auto".
  const { data: draftRows } = await supabase.from("draft_replies").select("lead_id").eq("business_id", business.id);
  const drafted = new Set((draftRows ?? []).map((d) => d.lead_id));

  const chats: ChatSummary[] = leads
    .map((lead) => {
      const m = last.get(lead.id);
      return {
        id: lead.id,
        name: displayName(lead),
        number: lead.wa_contact_number,
        hasName: !!lead.name,
        stage: lead.stage,
        needsYou: lead.pending_decision,
        hasDraft: drafted.has(lead.id),
        reason: lead.human_reason,
        note: lead.handoff_note,
        orderStatus: lead.order_status,
        quote: lead.quoted_price_myr,
        cold: isCold(lead, business.cold_after_days),
        lastBody: m?.body ?? null,
        lastDirection: m?.direction ?? null,
        lastSource: m?.source ?? null,
        lastAt: m?.sent_at ?? lead.last_message_at,
      };
    })
    .sort((a, b) => {
      if (a.needsYou !== b.needsYou) return a.needsYou ? -1 : 1;
      if (a.hasDraft !== b.hasDraft) return a.hasDraft ? -1 : 1;
      return (b.lastAt ?? "").localeCompare(a.lastAt ?? "");
    });

  const needsYou = chats.filter((c) => c.needsYou).length;
  const sidebarCollapsed = (await cookies()).get("sidebar-collapsed")?.value === "1";

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
            className="flex shrink-0 items-center justify-center gap-2 bg-warning px-4 py-2 text-center text-sm font-medium text-warning-foreground hover:underline"
          >
            <CreditCard className="size-4 shrink-0" aria-hidden />
            The assistant is paused. {subscriptionBlockedNote(subscription)}
          </Link>
        )}
        {trialDaysLeftCount !== null && trialDaysLeftCount <= 3 && (
          <Link
            href="/dashboard/billing"
            className="flex shrink-0 items-center justify-center gap-2 bg-info px-4 py-2 text-center text-sm font-medium text-info-foreground hover:underline"
          >
            <CreditCard className="size-4 shrink-0" aria-hidden />
            Your free trial ends in {trialDaysLeftCount} {trialDaysLeftCount === 1 ? "day" : "days"}. Subscribe to keep the assistant on.
          </Link>
        )}
        {!business.wa_phone_number_id && (
          <Link
            href="/dashboard/settings/whatsapp"
            className="flex shrink-0 items-center justify-center gap-2 bg-warning px-4 py-2 text-center text-sm font-medium text-warning-foreground hover:underline"
          >
            <MessageCircleWarning className="size-4 shrink-0" aria-hidden />
            Connect WhatsApp to start receiving customer messages
          </Link>
        )}
        {/* Once WhatsApp is connected, always show whether messages actually go out, so
            nobody is surprised either way: thinking the bot is live when it's still a
            sandbox, or not realising a deploy just switched them to sending for real. */}
        {business.wa_phone_number_id && sendMode(business.wa_access_token) === "dry" && (
          <div className="flex shrink-0 items-center justify-center gap-2 bg-info px-4 py-2 text-center text-sm font-medium text-info-foreground">
            <FlaskConical className="size-4 shrink-0" aria-hidden />
            Test mode: WhatsApp messages are not being sent to customers
          </div>
        )}
        {business.wa_phone_number_id && sendMode(business.wa_access_token) === "live" && (
          <div className="flex shrink-0 items-center justify-center gap-2 bg-success px-4 py-2 text-center text-sm font-medium text-success-foreground">
            <Radio className="size-4 shrink-0" aria-hidden />
            Live: messages are being sent to real customers on WhatsApp
          </div>
        )}
        <main className="min-h-0 flex-1">
          <DashboardFrame chats={chats}>{children}</DashboardFrame>
        </main>
        <MobileNav needsYou={needsYou} />
      </div>
    </div>
  );
}
