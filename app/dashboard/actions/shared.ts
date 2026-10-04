// Helpers the dashboard actions share. Not itself a set of actions (no "use server"), so components must
// only ever take types from here.
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { sendWhatsAppText } from "@/lib/send";
import { type ChatMessage, type LeadFields } from "@/lib/ai";
import { LEAD_COLUMNS, type Lead } from "@/lib/leads";

// Row level security makes sure each of these only touches the signed-in owner's data.
export interface FormState {
  ok?: boolean;
  error?: string;
  notice?: string;
}

export type Db = Awaited<ReturnType<typeof createClient>>;

export interface Context {
  lead: Lead & { business_id: string };
  business: {
    wa_phone_number_id: string;
    tone_notes: string | null;
    wa_access_token: string | null;
  };
  messages: ChatMessage[];
}

/** Load a lead with its business and recent chat. Returns an error message if something is missing. */
export async function loadContext(
  supabase: Db,
  leadId: string,
): Promise<Context | string> {
  const { data: leadRow } = await supabase
    .from("leads")
    .select(`${LEAD_COLUMNS}, business_id`)
    .eq("id", leadId)
    .single();
  if (!leadRow) return "Could not find this lead.";
  const lead = leadRow as unknown as Lead & { business_id: string };

  const { data: business } = await supabase
    .from("businesses")
    .select("wa_phone_number_id, tone_notes, wa_access_token")
    .eq("id", lead.business_id)
    .single();
  const phoneNumberId = business?.wa_phone_number_id;
  if (!business || !phoneNumberId)
    return "Could not find the WhatsApp number to send from.";

  const { data: rows } = await supabase
    .from("messages")
    .select("direction, body, sent_at, source")
    .eq("lead_id", leadId)
    .order("sent_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(30);
  const messages: ChatMessage[] = [...(rows ?? [])].reverse().map((r) => ({
    direction: r.direction === "out" ? "out" : "in",
    body: r.body ?? "",
    sentAt: r.sent_at,
    source: r.source,
  }));

  return { lead, business: { ...business, wa_phone_number_id: phoneNumberId }, messages };
}

export function leadFields(lead: Lead): LeadFields {
  return {
    name: lead.name,
    need: lead.need,
    budget_myr: lead.budget_myr,
    quoted_price_myr: lead.quoted_price_myr,
    deadline: lead.deadline,
    stage: lead.stage,
    language: lead.language,
  };
}

/** Send a message, record it in the conversation, and close the handover. */
export async function deliver(
  supabase: Db,
  ctx: Context,
  body: string,
  source: "bot" | "dashboard",
  extra: Record<string, unknown> = {},
): Promise<FormState> {
  let sent;
  try {
    sent = await sendWhatsAppText(
      ctx.business.wa_phone_number_id,
      ctx.lead.wa_contact_number,
      body,
      ctx.business.wa_access_token,
    );
  } catch (err) {
    console.error("Send failed", err);
    return {
      error:
        "WhatsApp did not accept the message. The customer may have last written more than 24 hours ago, or the access token may be wrong.",
    };
  }

  const now = new Date().toISOString();
  await supabase.from("messages").insert({
    lead_id: ctx.lead.id,
    business_id: ctx.lead.business_id,
    wa_message_id: sent.id,
    direction: "out",
    body,
    sent_at: now,
    source,
  });

  await supabase
    .from("leads")
    .update({
      last_message_at: now,
      last_outbound_at: now,
      last_chased_at: now,
      pending_decision: false,
      human_reason: null,
      handoff_note: null,
      bot_paused_until: null,
      updated_at: now,
      ...extra,
    })
    .eq("id", ctx.lead.id);

  revalidatePath("/dashboard", "layout");
  return {
    ok: true,
    notice: sent.dry
      ? "Test mode: saved in the conversation, not delivered to WhatsApp."
      : undefined,
  };
}
