"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { draftFollowUp, type ChatMessage, type LeadFields } from "@/lib/ai";
import {
  LEAD_COLUMNS,
  STAGES,
  daysSince,
  lastTouch,
  owesReply,
  type Lead,
  type Stage,
} from "@/lib/leads";

// Row level security makes sure each of these only touches the signed-in owner's data.

export interface FormState {
  ok?: boolean;
  error?: string;
}

/** Moving a lead to Won or Lost locks the stage so the AI does not reopen it. */
export async function moveStage(leadId: string, stage: Stage) {
  if (!STAGES.includes(stage)) return;
  const supabase = await createClient();

  const { data: lead } = await supabase
    .from("leads")
    .select("locked_fields")
    .eq("id", leadId)
    .single();
  const others = ((lead?.locked_fields as string[] | undefined) ?? []).filter((f) => f !== "stage");
  const locked = stage === "won" || stage === "lost" ? [...others, "stage"] : others;

  await supabase
    .from("leads")
    .update({ stage, locked_fields: locked, updated_at: new Date().toISOString() })
    .eq("id", leadId);
  revalidatePath("/dashboard", "layout");
}

export async function createDraft(leadId: string, _prev: FormState, _formData: FormData): Promise<FormState> {
  void _prev;
  void _formData;
  const supabase = await createClient();

  const { data: leadRow } = await supabase
    .from("leads")
    .select(`${LEAD_COLUMNS}, business_id`)
    .eq("id", leadId)
    .single();
  if (!leadRow) return { error: "Could not find this lead." };
  const lead = leadRow as Lead & { business_id: string };

  const { data: business } = await supabase
    .from("businesses")
    .select("tone_notes")
    .eq("id", lead.business_id)
    .single();

  const { data: rows } = await supabase
    .from("messages")
    .select("direction, body, sent_at")
    .eq("lead_id", leadId)
    .order("sent_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(30);

  // rows are newest first. Check who spoke last before reversing them.
  const newest = rows?.[0];
  const awaitingOwnerReply = owesReply(lead, newest);

  const messages: ChatMessage[] = [...(rows ?? [])]
    .reverse()
    .map((r) => ({ direction: r.direction, body: r.body ?? "", sentAt: r.sent_at }));

  const fields: LeadFields = {
    name: lead.name,
    need: lead.need,
    budget_myr: lead.budget_myr,
    quoted_price_myr: lead.quoted_price_myr,
    deadline: lead.deadline,
    stage: lead.stage,
    language: lead.language,
  };

  let body: string;
  try {
    body = await draftFollowUp({
      lead: fields,
      messages,
      daysQuiet: daysSince(lastTouch(lead)) ?? 0,
      toneNotes: business?.tone_notes,
      awaitingOwnerReply,
    });
  } catch (err) {
    console.error("Draft failed", err);
    return { error: "Could not write the draft. The AI may be busy or out of free requests. Try again in a minute." };
  }
  if (!body) return { error: "The AI returned an empty draft. Try again." };

  // Only one pending draft per lead.
  await supabase
    .from("drafts")
    .update({ status: "dismissed" })
    .eq("lead_id", leadId)
    .eq("status", "pending");

  await supabase.from("drafts").insert({
    lead_id: leadId,
    business_id: lead.business_id,
    body,
  });

  revalidatePath("/dashboard", "layout");
  return { ok: true };
}

/** "Sent" also records the chase, so the lead leaves the list until it goes quiet again. */
export async function setDraftStatus(draftId: string, status: "sent" | "dismissed") {
  const supabase = await createClient();

  const { data: draft } = await supabase
    .from("drafts")
    .update({ status })
    .eq("id", draftId)
    .select("lead_id")
    .single();

  if (status === "sent" && draft) {
    await supabase
      .from("leads")
      .update({ last_chased_at: new Date().toISOString() })
      .eq("id", draft.lead_id);
  }
  revalidatePath("/dashboard", "layout");
}

const EDITABLE = ["name", "need", "budget_myr", "quoted_price_myr", "deadline"] as const;

/** Save corrections from the lead page. Changed fields are locked against AI overwrites. */
export async function updateLead(leadId: string, _prev: FormState, formData: FormData): Promise<FormState> {
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
    .update({ ...next, locked_fields: [...locked], updated_at: new Date().toISOString() })
    .eq("id", leadId);
  if (error) return { error: "Could not save. Try again." };

  revalidatePath("/dashboard", "layout");
  return { ok: true };
}
