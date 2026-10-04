"use server";

// Lead edits: moving a stage, clearing a handoff, editing fields.
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { LEAD_COLUMNS, STAGES, type Lead, type Stage } from "@/lib/leads";
import { type FormState } from "@/app/dashboard/actions/shared";

// Row level security makes sure each of these only touches the signed-in owner's data.
/** Moving a lead to Won or Lost locks the stage so the AI does not reopen it. */
export async function moveStage(leadId: string, stage: Stage): Promise<FormState> {
  if (!STAGES.includes(stage)) return { error: "Unknown stage." };
  const supabase = await createClient();

  const { data: lead } = await supabase
    .from("leads")
    .select("locked_fields")
    .eq("id", leadId)
    .single();
  const others = ((lead?.locked_fields as string[] | undefined) ?? []).filter(
    (f) => f !== "stage",
  );
  const locked =
    stage === "won" || stage === "lost" ? [...others, "stage"] : others;

  const { error } = await supabase
    .from("leads")
    .update({
      stage,
      locked_fields: locked,
      updated_at: new Date().toISOString(),
    })
    .eq("id", leadId);
  if (error) {
    console.error("moveStage failed", error.code, error.message);
    return { error: "Could not change the stage. Try again." };
  }
  revalidatePath("/dashboard", "layout");
  return { ok: true };
}

/** For when you answered the customer outside the app. */
export async function clearPending(leadId: string) {
  const supabase = await createClient();
  await supabase
    .from("leads")
    .update({
      pending_decision: false,
      human_reason: null,
      handoff_note: null,
      bot_paused_until: null,
      last_chased_at: new Date().toISOString(),
    })
    .eq("id", leadId);
  revalidatePath("/dashboard", "layout");
}

const EDITABLE = [
  "name",
  "need",
  "budget_myr",
  "quoted_price_myr",
  "deadline",
] as const;

/** Save corrections from the lead page. Changed fields are locked against AI overwrites. */
export async function updateLead(
  leadId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  void _prev;
  const supabase = await createClient();

  const { data: current } = await supabase
    .from("leads")
    .select(LEAD_COLUMNS)
    .eq("id", leadId)
    .single();
  if (!current) return { error: "Could not find this lead." };
  const lead = current as unknown as Lead;

  const text = (key: string) => {
    const v = String(formData.get(key) ?? "").trim();
    return v === "" ? null : v;
  };
  const whole = (key: string) => {
    const v = text(key);
    if (v === null) return null;
    const n = Math.round(Number(v));
    return Number.isFinite(n) && n >= 0 ? n : NaN;
  };

  const next = {
    name: text("name"),
    need: text("need"),
    budget_myr: whole("budget_myr"),
    quoted_price_myr: whole("quoted_price_myr"),
    deadline: text("deadline"),
  };

  if (Number.isNaN(next.budget_myr) || Number.isNaN(next.quoted_price_myr)) {
    return { error: "Amounts must be whole numbers, like 220." };
  }
  if (next.deadline && !/^\d{4}-\d{2}-\d{2}$/.test(next.deadline)) {
    return { error: "Pick the deadline from the date picker." };
  }

  const locked = new Set(lead.locked_fields ?? []);
  for (const key of EDITABLE) {
    if (next[key] !== lead[key]) locked.add(key);
  }

  const { error } = await supabase
    .from("leads")
    .update({
      ...next,
      locked_fields: [...locked],
      updated_at: new Date().toISOString(),
    })
    .eq("id", leadId);
  if (error) return { error: "Could not save. Try again." };

  // The "OK to send follow-ups" switch.
  const agreed = formData.get("follow_up_consent") === "on";
  if (agreed !== (lead.follow_up_consent === "yes")) {
    const { error: consentError } = await supabase
      .from("leads")
      .update({ follow_up_consent: agreed ? "yes" : "no" })
      .eq("id", leadId);
    if (consentError)
      return { error: "Saved, but could not change the follow-up setting." };
  }

  revalidatePath("/dashboard", "layout");
  return { ok: true };
}
