import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeader, PageShell } from "@/components/app/page-shell";
import { FollowUpsView } from "@/components/follow-ups/follow-ups-view";
import { readSettings } from "@/lib/follow-up-settings";
import type {
  FeedbackItem,
  FollowUpLead,
  QueueItem,
} from "@/lib/follow-up-types";
import { sendMode } from "@/lib/send";
import { createClient } from "@/lib/supabase/server";
import { getOrCreateBusiness } from "@/lib/business";

export const metadata: Metadata = { title: "Follow-ups" };

function one<T>(v: T | T[] | null | undefined): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
}

const SECTIONS = ["queue", "feedback", "automations", "broadcast"] as const;

export default async function FollowUpsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  // ?tab=promotion opens the promotion form directly (the Overview's "Send a promotion" button).
  const { tab } = await searchParams;
  const wanted = tab === "promotion" ? "broadcast" : tab;
  const initialSection = SECTIONS.find((s) => s === wanted) ?? "queue";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const business = await getOrCreateBusiness<{
    id: string;
    follow_up_settings: unknown;
  }>(supabase, user, "id, follow_up_settings");
  if (!business) redirect("/dashboard");

  const { data: queueRows } = await supabase
    .from("follow_ups")
    .select(
      "id, kind, status, due_at, sent_at, detail, campaign, lead:leads(id, name, wa_contact_number, follow_up_consent)",
    )
    .eq("business_id", business.id)
    .order("due_at", { ascending: false })
    .limit(150);

  const { data: feedbackRows } = await supabase
    .from("feedback")
    .select(
      "id, rating, comment, created_at, lead:leads(id, name, wa_contact_number)",
    )
    .eq("business_id", business.id)
    .order("created_at", { ascending: false })
    .limit(60);

  const { count: audience } = await supabase
    .from("leads")
    .select("id", { count: "exact", head: true })
    .eq("business_id", business.id)
    .eq("follow_up_consent", "yes")
    .eq("pending_decision", false)
    .or("order_status.eq.paid,stage.eq.won");

  const { count: optedIn } = await supabase
    .from("leads")
    .select("id", { count: "exact", head: true })
    .eq("business_id", business.id)
    .eq("follow_up_consent", "yes");

  const queue = (queueRows ?? []).map((r) => ({
    ...r,
    lead: one(r.lead as FollowUpLead | FollowUpLead[] | null),
  })) as QueueItem[];
  const feedback = (feedbackRows ?? []).map((r) => ({
    ...r,
    lead: one(
      r.lead as
        | FeedbackItem["lead"]
        | NonNullable<FeedbackItem["lead"]>[]
        | null,
    ),
  })) as FeedbackItem[];

  return (
    <PageShell>
      <PageHeader
        title="Follow-ups"
        description="After-sale messages: feedback requests, reorder reminders and promotions. Customers must agree to receive them first."
      />
      <FollowUpsView
        queue={queue}
        feedback={feedback}
        settings={readSettings(business.follow_up_settings)}
        audience={audience ?? 0}
        optedIn={optedIn ?? 0}
        testMode={sendMode() === "dry"}
        initialSection={initialSection}
      />
    </PageShell>
  );
}
