import Link from "next/link";
import { redirect } from "next/navigation";
import { LeadCard } from "@/components/LeadCard";
import { NeedsYouCard } from "@/components/NeedsYouCard";
import { Shell, displayFont } from "@/components/Shell";
import { SubmitButton } from "@/components/SubmitButton";
import { signOut } from "@/app/login/actions";
import { createClient } from "@/lib/supabase/server";
import {
  LEAD_COLUMNS,
  STAGES,
  STAGE_DOT,
  STAGE_LABEL,
  daysSince,
  isCold,
  lastTouch,
  rm,
  type LastMessage,
  type Lead,
} from "@/lib/leads";

export default async function Dashboard() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: business } = await supabase
    .from("businesses")
    .select("id, name, cold_after_days, auto_reply")
    .eq("owner_id", user.id)
    .maybeSingle();

  if (!business) {
    return (
      <Shell>
        <main className="mx-auto max-w-xl px-6 py-24">
          <h1 className="text-3xl font-bold tracking-tight" style={displayFont}>
            No business linked yet
          </h1>
          <p className="mt-3 text-[#55645E]">
            Add a row to the businesses table with owner_id set to your user id ({user.id}), then
            refresh this page.
          </p>
        </main>
      </Shell>
    );
  }

  const { data: leadRows } = await supabase
    .from("leads")
    .select(LEAD_COLUMNS)
    .eq("business_id", business.id)
    .order("last_message_at", { ascending: false, nullsFirst: false });

  const leads = (leadRows ?? []) as unknown as Lead[];
  // Chats the assistant handed to you. Everything else, the assistant handles alone.
  const needsYou = leads
    .filter((l) => l.pending_decision)
    .sort((a, b) => (daysSince(lastTouch(b)) ?? 0) - (daysSince(lastTouch(a)) ?? 0));
  const needsIds = new Set(needsYou.map((l) => l.id));
  const coldIds = new Set(leads.filter((l) => isCold(l, business.cold_after_days)).map((l) => l.id));

  // The last thing said in each of those chats, so you remember where it stopped.
  const lastByLead = new Map<string, LastMessage>();
  if (needsYou.length > 0) {
    const { data: msgRows } = await supabase
      .from("messages")
      .select("lead_id, direction, body, sent_at")
      .in("lead_id", [...needsIds])
      .order("sent_at", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(500);
    for (const m of (msgRows ?? []) as LastMessage[]) {
      if (!lastByLead.has(m.lead_id)) lastByLead.set(m.lead_id, m);
    }
  }

  const waiting = needsYou.reduce((sum, l) => sum + (l.quoted_price_myr ?? 0), 0);

  return (
    <Shell>
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
        <header className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[#55645E]">{business.name}</p>
            <h1
              className="mt-1 text-3xl font-bold leading-tight tracking-tight sm:text-4xl"
              style={displayFont}
            >
              {needsYou.length === 0
                ? "Nothing needs you right now"
                : `${needsYou.length} ${needsYou.length === 1 ? "chat needs" : "chats need"} you`}
            </h1>
            {waiting > 0 && (
              <p className="mt-2 text-lg text-[#55645E]">
                {rm(waiting)} in orders waiting on you
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/dashboard/settings"
              className="rounded-full border border-[#D8E0DA] bg-white px-4 py-2 text-sm font-medium hover:border-[#1F7A5C] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1F7A5C]"
            >
              Assistant: {business.auto_reply ? "on" : "off"}
            </Link>
            <form action={signOut}>
              <SubmitButton pendingText="Signing out...">Sign out</SubmitButton>
            </form>
          </div>
        </header>

        <section className="mt-8" aria-labelledby="needs-you">
          <h2 id="needs-you" className="sr-only">
            Chats that need you
          </h2>
          {needsYou.length === 0 ? (
            <p className="max-w-prose text-[#55645E]">
              {business.auto_reply
                ? "The assistant is handling your chats. Anything it cannot decide alone shows up here."
                : "The assistant is off, so nothing is answered automatically. Turn it on in Settings."}
            </p>
          ) : (
            <ul className="space-y-3">
              {needsYou.map((lead) => (
                <NeedsYouCard key={lead.id} lead={lead} last={lastByLead.get(lead.id)} />
              ))}
            </ul>
          )}
        </section>

        <section className="mt-14" aria-labelledby="pipeline">
          <h2 id="pipeline" className="text-2xl font-bold tracking-tight" style={displayFont}>
            Pipeline
          </h2>
          <div className="mt-4 flex snap-x gap-4 overflow-x-auto pb-4 lg:grid lg:grid-cols-5 lg:overflow-visible">
            {STAGES.map((stage) => {
              const inStage = leads.filter((l) => l.stage === stage);
              const value = inStage.reduce((sum, l) => sum + (l.quoted_price_myr ?? 0), 0);
              return (
                <div key={stage} className="w-64 shrink-0 snap-start lg:w-auto">
                  <h3 className="mb-2 flex items-center gap-2 font-semibold">
                    <span
                      aria-hidden
                      className="inline-block size-2.5 rounded-full"
                      style={{ background: STAGE_DOT[stage] }}
                    />
                    {STAGE_LABEL[stage]}
                    <span className="font-normal text-[#55645E]">{inStage.length}</span>
                    {value > 0 && (
                      <span className="ml-auto text-sm font-normal text-[#55645E]">{rm(value)}</span>
                    )}
                  </h3>
                  {inStage.length === 0 ? (
                    <p className="rounded-lg border border-dashed border-[#D8E0DA] p-3 text-sm text-[#55645E]">
                      No leads here
                    </p>
                  ) : (
                    <ul className="space-y-2">
                      {inStage.map((lead) => (
                        <LeadCard key={lead.id} lead={lead} cold={coldIds.has(lead.id)} />
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      </main>
    </Shell>
  );
}
