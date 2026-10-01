import { redirect } from "next/navigation";
import { DashboardFrame } from "@/components/app/dashboard-frame";
import { createClient } from "@/lib/supabase/server";
import { getOrCreateBusiness } from "@/lib/business";
import {
  LEAD_COLUMNS,
  displayName,
  isCold,
  waitingLabel,
  type ChatSummary,
  type Lead,
} from "@/lib/leads";

const BUSINESS_COLUMNS = "id, cold_after_days";

interface MessagingBusiness {
  id: string;
  cold_after_days: number;
}

export default async function MessagingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const business = await getOrCreateBusiness<MessagingBusiness>(
    supabase,
    user,
    BUSINESS_COLUMNS,
  );
  if (!business) return null;

  const { data: leadRows, error: leadsError } = await supabase
    .from("leads")
    .select(`${LEAD_COLUMNS}, last_inbound_at, created_at`)
    .eq("business_id", business.id)
    .order("last_message_at", { ascending: false, nullsFirst: false });
  // A failed query must not look like "no chats yet". Let the error page take over.
  if (leadsError) throw new Error(`Could not load chats: ${leadsError.message}`);
  const leads = (leadRows ?? []) as unknown as (Lead & {
    last_inbound_at: string | null;
    created_at: string;
  })[];

  type LastMsg = {
    direction: "in" | "out";
    body: string | null;
    sent_at: string;
    source: string | null;
  };
  const last = new Map<string, LastMsg>();

  // One row per chat, so a quiet chat keeps its preview however busy the rest of the inbox is
  // (migration 0014). If that function is not installed yet, fall back to the newest 600 messages.
  const { data: lastRows, error: lastError } = await supabase.rpc(
    "last_messages",
    { p_business_id: business.id },
  );
  if (!lastError && lastRows) {
    for (const m of lastRows as (LastMsg & { lead_id: string })[])
      last.set(m.lead_id, m);
  } else {
    const { data: msgRows } = await supabase
      .from("messages")
      .select("lead_id, direction, body, sent_at, source")
      .eq("business_id", business.id)
      .order("sent_at", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(600);
    for (const m of (msgRows ?? []) as (LastMsg & { lead_id: string })[])
      if (!last.has(m.lead_id)) last.set(m.lead_id, m);
  }

  const { data: draftRows } = await supabase
    .from("draft_replies")
    .select("lead_id")
    .eq("business_id", business.id);
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
        waiting: lead.pending_decision
          ? waitingLabel(lead.last_inbound_at ?? lead.created_at)
          : null,
      };
    })
    .sort((a, b) => {
      if (a.needsYou !== b.needsYou) return a.needsYou ? -1 : 1;
      if (a.hasDraft !== b.hasDraft) return a.hasDraft ? -1 : 1;
      return (b.lastAt ?? "").localeCompare(a.lastAt ?? "");
    });

  return <DashboardFrame chats={chats}>{children}</DashboardFrame>;
}
