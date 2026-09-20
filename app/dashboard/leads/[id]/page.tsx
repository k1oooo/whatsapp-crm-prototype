import { notFound, redirect } from "next/navigation";
import { ChatHeader } from "@/components/chat/chat-header";
import { ChatThread, type Msg } from "@/components/chat/chat-thread";
import { OrderStrip } from "@/components/chat/order-strip";
import { StatusBar } from "@/components/chat/status-bar";
import { createClient } from "@/lib/supabase/server";
import { LEAD_COLUMNS, REASON_LABEL, type Lead } from "@/lib/leads";

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: leadRow } = await supabase
    .from("leads")
    .select(`${LEAD_COLUMNS}, bot_paused_until`)
    .eq("id", id)
    .maybeSingle();
  if (!leadRow) notFound();
  const lead = leadRow as unknown as Lead & { bot_paused_until: string | null };

  const { data: business } = await supabase
    .from("businesses")
    .select("auto_reply")
    .eq("owner_id", user.id)
    .maybeSingle();

  const { data: msgRows } = await supabase
    .from("messages")
    .select("id, direction, body, sent_at, source")
    .eq("lead_id", id)
    .order("sent_at", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(300);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ChatHeader lead={lead} />
      <OrderStrip lead={lead} />
      <ChatThread
        key={lead.id}
        messages={(msgRows ?? []) as Msg[]}
        handoff={
          lead.pending_decision
            ? {
                leadId: lead.id,
                reason: lead.human_reason,
                title: lead.human_reason
                  ? (REASON_LABEL[lead.human_reason] ?? lead.human_reason)
                  : "you said you would check",
                note: lead.handoff_note,
              }
            : null
        }
      />
      <StatusBar
        pending={lead.pending_decision}
        autoReply={business?.auto_reply ?? false}
        pausedUntil={lead.bot_paused_until}
      />
    </div>
  );
}
