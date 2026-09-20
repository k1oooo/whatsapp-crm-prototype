import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChatScroll } from "@/components/ChatScroll";
import { InlineHandoff } from "@/components/InlineHandoff";
import { LeadEditForm } from "@/components/LeadEditForm";
import { Shell, displayFont } from "@/components/Shell";
import { StageSelect } from "@/components/StageSelect";
import { createClient } from "@/lib/supabase/server";
import {
  LEAD_COLUMNS,
  ORDER_LABEL,
  REASON_LABEL,
  displayName,
  formatTime,
  type Lead,
} from "@/lib/leads";

interface Msg {
  id: string;
  direction: "in" | "out";
  body: string | null;
  sent_at: string;
  source: string | null;
}

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: leadRow } = await supabase.from("leads").select(LEAD_COLUMNS).eq("id", id).maybeSingle();
  if (!leadRow) notFound();
  const lead = leadRow as unknown as Lead;

  const { data: msgRows } = await supabase
    .from("messages")
    .select("id, direction, body, sent_at, source")
    .eq("lead_id", id)
    .order("sent_at", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(200);
  const messages = (msgRows ?? []) as Msg[];

  return (
    <Shell>
      {/* On large screens the page fits the window and only the conversation scrolls. */}
      <main className="mx-auto flex max-w-5xl flex-col px-4 py-5 sm:px-6 lg:h-dvh lg:overflow-hidden">
        <Link
          href="/dashboard"
          className="text-sm text-[#55645E] hover:underline focus-visible:outline-2 focus-visible:outline-[#1F7A5C]"
        >
          Back to dashboard
        </Link>

        <header className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-baseline gap-x-3">
            <h1 className="text-2xl font-bold leading-tight tracking-tight sm:text-3xl" style={displayFont}>
              {displayName(lead)}
            </h1>
            {lead.name && <p className="text-[#55645E]">+{lead.wa_contact_number}</p>}
          </div>
          <StageSelect leadId={lead.id} stage={lead.stage} />
        </header>

        <div className="mt-4 grid gap-6 lg:min-h-0 lg:flex-1 lg:grid-cols-[3fr_2fr] lg:gap-10">
          <section aria-labelledby="chat" className="flex min-h-0 flex-col">
            <h2 id="chat" className="text-lg font-bold tracking-tight" style={displayFont}>
              Conversation
            </h2>

            {messages.length === 0 && !lead.pending_decision ? (
              <p className="mt-3 text-[#55645E]">No messages yet.</p>
            ) : (
              <ChatScroll count={messages.length + (lead.pending_decision ? 1 : 0)}>
                <ul className="space-y-3">
                  {messages.map((m) => (
                    <li key={m.id} className={`flex ${m.direction === "out" ? "justify-end" : ""}`}>
                      <div
                        className={`max-w-[85%] rounded-2xl px-4 py-2 ${
                          m.direction === "out"
                            ? m.source === "bot"
                              ? "rounded-tr-sm border border-[#BFDCCB] bg-[#E6F2EA]"
                              : "rounded-tr-sm bg-[#D3EFC4]"
                            : "rounded-tl-sm border border-[#D8E0DA] bg-white"
                        }`}
                      >
                        <p className="whitespace-pre-wrap">{m.body}</p>
                        <p className="mt-1 text-xs text-[#55645E]">
                          {m.direction === "out" ? (m.source === "bot" ? "Assistant" : "You") : displayName(lead)},{" "}
                          {formatTime(m.sent_at)}
                        </p>
                      </div>
                    </li>
                  ))}
                  {lead.pending_decision && (
                    <InlineHandoff
                      key={lead.handoff_note ?? lead.human_reason ?? "pending"}
                      leadId={lead.id}
                      reason={lead.human_reason}
                      title={
                        lead.human_reason
                          ? (REASON_LABEL[lead.human_reason] ?? lead.human_reason)
                          : "you said you would check"
                      }
                      note={lead.handoff_note}
                    />
                  )}
                </ul>
              </ChatScroll>
            )}
          </section>

          <section aria-labelledby="details" className="min-h-0 lg:overflow-y-auto">
            {lead.order_summary && lead.order_status && (
              <div className="mb-4 rounded-lg bg-[#EAF3EC] px-4 py-2">
                <p className="font-semibold">
                  Order: {ORDER_LABEL[lead.order_status] ?? lead.order_status}
                </p>
                <p className="mt-0.5 whitespace-pre-wrap">{lead.order_summary}</p>
              </div>
            )}
            <h2 id="details" className="mb-3 text-lg font-bold tracking-tight" style={displayFont}>
              Details
            </h2>
            <LeadEditForm lead={lead} />
          </section>
        </div>
      </main>
    </Shell>
  );
}
