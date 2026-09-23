"use server";

import { revalidatePath } from "next/cache";
import type { FormState } from "@/app/dashboard/actions";
import { DEFAULT_FEEDBACK_TEXT, DEFAULT_REORDER_TEXT, type FollowUpSettings } from "@/lib/follow-up-settings";
import { runDueFollowUps } from "@/lib/follow-ups";
import { createClient } from "@/lib/supabase/server";

type Db = Awaited<ReturnType<typeof createClient>>;

async function myBusinessId(supabase: Db): Promise<string | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase.from("businesses").select("id").eq("owner_id", user.id).maybeSingle();
  return data?.id ?? null;
}

function summaryText(s: { sent: number; skipped: number; failed: number; waiting: number }): string {
  const parts = [
    s.sent && `${s.sent} sent`,
    s.waiting && `${s.waiting} waiting for the customer's OK or for you`,
    s.skipped && `${s.skipped} skipped`,
    s.failed && `${s.failed} failed`,
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : "Nothing was due";
}

export async function saveFollowUpSettings(_prev: FormState, formData: FormData): Promise<FormState> {
  void _prev;
  const supabase = await createClient();
  const businessId = await myBusinessId(supabase);
  if (!businessId) return { error: "Please sign in again." };

  const text = (k: string) => String(formData.get(k) ?? "").trim();
  const days = (k: string, fallback: number, max: number) => {
    const n = Math.round(Number(text(k)));
    return Number.isFinite(n) ? Math.min(max, Math.max(0, n)) : fallback;
  };

  const reviewLink = text("review_link");
  if (reviewLink && !/^https?:\/\//i.test(reviewLink)) {
    return { error: "The review link must start with http:// or https://" };
  }

  const settings: FollowUpSettings = {
    feedback: {
      enabled: formData.get("feedback_enabled") === "on",
      delayDays: days("feedback_delay", 1, 60),
      templateName: text("feedback_template"),
      text: text("feedback_text") || DEFAULT_FEEDBACK_TEXT,
    },
    reorder: {
      enabled: formData.get("reorder_enabled") === "on",
      afterDays: Math.max(1, days("reorder_after", 30, 365)),
      templateName: text("reorder_template"),
      text: text("reorder_text") || DEFAULT_REORDER_TEXT,
    },
    reviewLink,
    language: text("language") || "ms",
  };

  const { error } = await supabase.from("businesses").update({ follow_up_settings: settings }).eq("id", businessId);
  if (error) return { error: "Could not save. Is migration 0007 applied?" };

  revalidatePath("/dashboard/follow-ups");
  return { ok: true };
}

/** Send everything that is due right now. */
export async function runFollowUpsNow(): Promise<FormState> {
  const supabase = await createClient();
  const businessId = await myBusinessId(supabase);
  if (!businessId) return { error: "Please sign in again." };

  const summary = await runDueFollowUps(supabase, { businessId, ignoreQuietHours: true });
  revalidatePath("/dashboard/follow-ups");
  return { ok: true, notice: summaryText(summary) };
}

export async function skipFollowUp(id: string): Promise<FormState> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("follow_ups")
    .update({ status: "skipped", detail: "Skipped by you" })
    .eq("id", id)
    .eq("status", "scheduled");
  if (error) return { error: "Could not skip it." };
  revalidatePath("/dashboard/follow-ups");
  return { ok: true };
}

export async function sendFollowUpNow(id: string): Promise<FormState> {
  const supabase = await createClient();
  const businessId = await myBusinessId(supabase);
  if (!businessId) return { error: "Please sign in again." };

  // Also used by "Try again" on a skipped or failed follow-up.
  await supabase
    .from("follow_ups")
    .update({ status: "scheduled", detail: null, due_at: new Date().toISOString() })
    .eq("id", id)
    .in("status", ["scheduled", "skipped", "failed"]);
  const summary = await runDueFollowUps(supabase, { businessId, onlyId: id, ignoreQuietHours: true });

  revalidatePath("/dashboard/follow-ups");
  if (summary.failed) return { error: "It could not be sent. See the reason in the list." };
  return { ok: true, notice: summaryText(summary) };
}

/** Queue a promotion for every customer who agreed to follow-ups and has paid for an order. */
export async function sendBroadcast(_prev: FormState, formData: FormData): Promise<FormState> {
  void _prev;
  const supabase = await createClient();
  const businessId = await myBusinessId(supabase);
  if (!businessId) return { error: "Please sign in again." };

  const body = String(formData.get("text") ?? "").trim();
  const templateName = String(formData.get("template") ?? "").trim();
  const campaign = String(formData.get("campaign") ?? "").trim() || body.slice(0, 40);
  if (!body) return { error: "Write the message first." };

  const { data: audience, error: audienceError } = await supabase
    .from("leads")
    .select("id")
    .eq("business_id", businessId)
    .eq("follow_up_consent", "yes")
    .eq("pending_decision", false)
    .or("order_status.eq.paid,stage.eq.won")
    .limit(300);
  if (audienceError) return { error: "Could not read your customers. Is migration 0007 applied?" };
  if (!audience || audience.length === 0) {
    return { error: "Nobody has agreed to receive offers yet, so there is no one to send this to." };
  }

  const now = new Date().toISOString();
  const { error } = await supabase.from("follow_ups").insert(
    audience.map((lead) => ({
      business_id: businessId,
      lead_id: lead.id,
      kind: "marketing",
      campaign,
      template_name: templateName,
      body,
      due_at: now,
    })),
  );
  if (error) return { error: "Could not queue the messages." };

  // Sends now if it is daytime in Malaysia, otherwise the daily job sends it at 10am.
  const summary = await runDueFollowUps(supabase, { businessId });
  revalidatePath("/dashboard/follow-ups");
  return {
    ok: true,
    notice:
      summary.sent + summary.failed + summary.skipped > 0
        ? summaryText(summary)
        : `Queued for ${audience.length} customers. They go out at 10am.`,
  };
}
