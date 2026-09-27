import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { FlaskConical, MessageCircleWarning, Radio } from "lucide-react";
import { DashboardFrame } from "@/components/app/dashboard-frame";
import { MobileNav } from "@/components/app/nav";
import { Sidebar } from "@/components/app/sidebar";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import { LEAD_COLUMNS, displayName, isCold, type ChatSummary, type Lead } from "@/lib/leads";
import { sendMode } from "@/lib/send";

const BUSINESS_COLUMNS = "id, name, auto_reply, cold_after_days, wa_phone_number_id, wa_access_token";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  let { data: business } = await supabase
    .from("businesses")
    .select(BUSINESS_COLUMNS)
    .eq("owner_id", user.id)
    .maybeSingle();

  // First time this owner reaches the dashboard: create their business row now, named from
  // whatever they typed on the signup form (falls back if they signed up before this existed).
  if (!business) {
    const name = (user.user_metadata?.business_name as string | undefined)?.trim() || "My business";
    const { data: created, error } = await supabase
      .from("businesses")
      .insert({ owner_id: user.id, name })
      .select(BUSINESS_COLUMNS)
      .single();

    if (created) {
      business = created;
    } else if (error?.code === "23505") {
      // Another request (double click, two tabs) created it a moment ago.
      const { data: again } = await supabase
        .from("businesses")
        .select(BUSINESS_COLUMNS)
        .eq("owner_id", user.id)
        .maybeSingle();
      business = again ?? null;
    }

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
