import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { ChatComposer } from "@/components/chat/composer";
import { ChatHeader } from "@/components/chat/chat-header";
import { ChatThread, type Msg } from "@/components/chat/chat-thread";
import { OrderStrip } from "@/components/chat/order-strip";
import { StatusBar } from "@/components/chat/status-bar";
import { createClient } from "@/lib/supabase/server";
import { LEAD_COLUMNS, REASON_LABEL, type Lead } from "@/lib/leads";

const MESSAGE_LIMIT = 300;

export const metadata: Metadata = { title: "Chat" };

export default async function LeadPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: leadRow, error: leadError } = await supabase
    .from("leads")
    .select(`${LEAD_COLUMNS}, bot_paused_until`)
    .eq("id", id)
    .maybeSingle();
  if (leadError) throw new Error(`Could not load this chat: ${leadError.message}`);
  if (!leadRow) notFound();
  const lead = leadRow as unknown as Lead & { bot_paused_until: string | null };

  const { data: business } = await supabase
    .from("businesses")
    .select("auto_reply")
    .eq("owner_id", user.id)
    .maybeSingle();

  // The newest messages, shown oldest first. Ordering newest first before the limit is what keeps
  // the latest turn on screen in a long chat. One extra row tells us there is older history.
  const { data: msgRows, error: msgError } = await supabase
    .from("messages")
    .select("id, direction, body, sent_at, source")
    .eq("lead_id", id)
    .order("sent_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(MESSAGE_LIMIT + 1);
  if (msgError) throw new Error(`Could not load messages: ${msgError.message}`);
  const hasEarlier = (msgRows ?? []).length > MESSAGE_LIMIT;
  const messages = (msgRows ?? []).slice(0, MESSAGE_LIMIT).reverse() as Msg[];

  // Present only when reply_mode is "approve" and the assistant has something waiting for a
  // decision. Harmless to always look: no row exists at all in "auto" mode.
  const { data: draftRow } = await supabase
    .from("draft_replies")
    .select("body")
    .eq("lead_id", id)
    .maybeSingle();

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-chat">
      <ChatHeader lead={lead} />
      <OrderStrip lead={lead} />
      <ChatThread
        key={lead.id}
        leadId={lead.id}
        messages={messages}
        hasEarlier={hasEarlier}
        handoff={
          lead.pending_decision
            ? {
                leadId: lead.id,
                reason: lead.human_reason,
                title: lead.human_reason
                  ? (REASON_LABEL[lead.human_reason] ?? lead.human_reason)
                  : "you said you would check",
                note: lead.handoff_note,
                amount: lead.quoted_price_myr,
              }
            : null
        }
        draft={draftRow ? { leadId: lead.id, body: draftRow.body } : null}
      />
      <ChatComposer leadId={lead.id} number={lead.wa_contact_number} />
      <StatusBar
        pending={lead.pending_decision}
        autoReply={business?.auto_reply ?? false}
        pausedUntil={lead.bot_paused_until}
      />
    </div>
  );
}
