import { redirect } from "next/navigation";
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

function one<T>(v: T | T[] | null | undefined): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
}

export default async function FollowUpsPage() {
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
    // FIXED: Added overflow-x-hidden here to strictly prevent the page from moving sideways
    <div className="flex-1 min-h-0 w-full overflow-y-auto overflow-x-hidden scroll-stable">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4 pb-24 md:gap-6 sm:p-6 lg:p-8">
        <header>
          <h1 className="font-heading text-2xl md:text-3xl font-bold">
            Follow-ups
          </h1>
          <p className="mt-1 max-w-2xl text-sm md:text-base text-muted-foreground">
            After-sale messages: feedback requests, reorder reminders and
            promotions. Customers must agree to receive them first.
          </p>
        </header>
        <FollowUpsView
          queue={queue}
          feedback={feedback}
          settings={readSettings(business.follow_up_settings)}
          audience={audience ?? 0}
          optedIn={optedIn ?? 0}
          testMode={sendMode() === "dry"}
        />
      </div>
    </div>
  );
}
