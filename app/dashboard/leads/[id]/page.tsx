import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { DraftPanel } from "@/components/DraftPanel";
import { LeadEditForm } from "@/components/LeadEditForm";
import { Shell, displayFont } from "@/components/Shell";
import { StageSelect } from "@/components/StageSelect";
import { createClient } from "@/lib/supabase/server";
import { LEAD_COLUMNS, displayName, formatTime, type Draft, type Lead } from "@/lib/leads";

interface Msg {
  id: string;
  direction: "in" | "out";
  body: string | null;
  sent_at: string;
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
    .select("id, direction, body, sent_at")
    .eq("lead_id", id)
    .order("sent_at", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(200);
  const messages = (msgRows ?? []) as Msg[];

  const { data: draftRow } = await supabase
    .from("drafts")
    .select("id, lead_id, body, created_at")
    .eq("lead_id", id)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return (
    <Shell>
      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-12">
        <Link
          href="/dashboard"
          className="text-sm text-[#55645E] hover:underline focus-visible:outline-2 focus-visible:outline-[#1F7A5C]"
        >
          Back to dashboard
        </Link>

        <header className="mt-4 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold leading-tight tracking-tight sm:text-4xl" style={displayFont}>
              {displayName(lead)}
            </h1>
            {lead.name && <p className="mt-1 text-[#55645E]">+{lead.wa_contact_number}</p>}
          </div>
          <StageSelect leadId={lead.id} stage={lead.stage} />
        </header>

        <div className="mt-8 grid gap-10 lg:grid-cols-[3fr_2fr]">
          <section aria-labelledby="chat">
            <h2 id="chat" className="text-xl font-bold tracking-tight" style={displayFont}>
              Conversation
            </h2>

            {messages.length === 0 ? (
              <p className="mt-3 text-[#55645E]">No messages yet.</p>
            ) : (
              <ul className="mt-4 space-y-3">
                {messages.map((m) => (
                  <li key={m.id} className={`flex ${m.direction === "out" ? "justify-end" : ""}`}>
                    <div
                      className={`max-w-[85%] rounded-2xl px-4 py-2 ${
                        m.direction === "out"
                          ? "rounded-tr-sm bg-[#D3EFC4]"
                          : "rounded-tl-sm border border-[#D8E0DA] bg-white"
                      }`}
                    >
                      <p className="whitespace-pre-wrap">{m.body}</p>
                      <p className="mt-1 text-xs text-[#55645E]">
                        {m.direction === "out" ? "You" : displayName(lead)}, {formatTime(m.sent_at)}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-8">
              <h2 className="mb-3 text-xl font-bold tracking-tight" style={displayFont}>
                Follow up
              </h2>
              <DraftPanel lead={lead} draft={(draftRow as Draft | null) ?? undefined} />
            </div>
          </section>

          <section aria-labelledby="details">
            <h2 id="details" className="mb-4 text-xl font-bold tracking-tight" style={displayFont}>
              Details
            </h2>
            <LeadEditForm lead={lead} />
          </section>
        </div>
      </main>
    </Shell>
  );
}
