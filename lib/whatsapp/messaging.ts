// Small helpers for messaging a customer from inside the assistant.
import type { SupabaseClient } from "@supabase/supabase-js";
import { sendWhatsAppText } from "@/lib/send";
import { type BusinessInfo } from "@/lib/whatsapp/types";

/** The bank details from Settings. Returns null if they are not set (or migration 0006 is missing). */
export async function getPaymentDetails(db: SupabaseClient, businessId: string): Promise<string | null> {
  const { data, error } = await db
    .from("businesses")
    .select("payment_details")
    .eq("id", businessId)
    .maybeSingle();
  if (error) console.error("Could not read payment details (is migration 0006 applied?)", error.message);
  const text = (data?.payment_details as string | null | undefined)?.trim();
  return text ? text : null;
}

/** Send a short message to the customer and record it in the chat. */
export async function sayToCustomer(
  db: SupabaseClient,
  business: BusinessInfo,
  leadId: string,
  to: string,
  body: string,
): Promise<void> {
  const sent = await sendWhatsAppText(business.wa_phone_number_id, to, body, business.wa_access_token);
  const now = new Date().toISOString();
  await db.from("messages").insert({
    lead_id: leadId,
    business_id: business.id,
    wa_message_id: sent.id,
    direction: "out",
    body,
    sent_at: now,
    source: "bot",
  });
  await db
    .from("leads")
    .update({ last_message_at: now, last_outbound_at: now, updated_at: now })
    .eq("id", leadId);
}
