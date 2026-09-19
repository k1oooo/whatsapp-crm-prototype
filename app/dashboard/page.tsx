import { redirect } from "next/navigation";
import { ChaseItem } from "@/components/ChaseItem";
import { LeadCard } from "@/components/LeadCard";
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
  owesReply,
  rm,
  type Draft,
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
    .select("id, name, cold_after_days")
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

  const { data: draftRows } = await supabase
    .from("drafts")
    .select("id, lead_id, body, created_at")
    .eq("business_id", business.id)
    .eq("status", "pending")
    .order("created_at", { ascending: false });

  const leads = (leadRows ?? []) as unknown as Lead[];
  const drafts = (draftRows ?? []) as Draft[];

  const draftByLead = new Map<string, Draft>();
  for (const d of drafts) if (!draftByLead.has(d.lead_id)) draftByLead.set(d.lead_id, d);

  const coldLeads = leads.filter((l) => isCold(l, business.cold_after_days));
  const coldIds = new Set(coldLeads.map((l) => l.id));

  // The last thing said in each cold chat, so you remember where it stopped.
  const lastByLead = new Map<string, LastMessage>();
  if (coldLeads.length > 0) {
    const { data: msgRows } = await supabase
      .from("messages")
      .select("lead_id, direction, body, sent_at")
      .in("lead_id", [...coldIds])
      .order("sent_at", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(500);
    for (const m of (msgRows ?? []) as LastMessage[]) {
      if (!lastByLead.has(m.lead_id)) lastByLead.set(m.lead_id, m);
    }
  }

  // Customers waiting on you come first, then the nearest deadline, then the longest quiet.
  const cold = [...coldLeads].sort((a, b) => {
    const oa = owesReply(a, lastByLead.get(a.id)) ? 0 : 1;
    const ob = owesReply(b, lastByLead.get(b.id)) ? 0 : 1;
    if (oa !== ob) return oa - ob;
    const da = a.deadline ?? "9999-12-31";
    const db = b.deadline ?? "9999-12-31";
    if (da !== db) return da < db ? -1 : 1;
    return (daysSince(lastTouch(b)) ?? 0) - (daysSince(lastTouch(a)) ?? 0);
  });

  const waiting = cold.reduce((sum, l) => sum + (l.quoted_price_myr ?? 0), 0);

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
              {cold.length === 0
                ? "Nobody to chase today"
                : `${cold.length} ${cold.length === 1 ? "lead" : "leads"} to chase today`}
            </h1>
            {waiting > 0 && (
              <p className="mt-2 text-lg text-[#55645E]">
                {rm(waiting)} in quotes on these leads
              </p>
            )}
          </div>
          <form action={signOut}>
            <SubmitButton pendingText="Signing out...">Sign out</SubmitButton>
          </form>
        </header>

        <section className="mt-8" aria-labelledby="chase">
          <h2 id="chase" className="sr-only">
            Leads to chase
          </h2>
          {cold.length === 0 ? (
            <p className="max-w-prose text-[#55645E]">
              A lead shows up here after {business.cold_after_days} days without a message.
            </p>
          ) : (
            <ul className="space-y-3">
              {cold.map((lead) => (
                <ChaseItem
                  key={lead.id}
                  lead={lead}
                  draft={draftByLead.get(lead.id)}
                  last={lastByLead.get(lead.id)}
                />
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
