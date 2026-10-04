// Shared shapes for the WhatsApp flow: the webhook payload (only the fields we use) and a business row.
import { type SubscriptionInfo } from "@/lib/subscriptions";

export interface BusinessInfo {
  id: string;
  wa_phone_number_id: string;
  auto_reply: boolean;
  reply_mode?: "auto" | "approve" | null;
  business_facts: string | null;
  tone_notes: string | null;
  wa_access_token: string | null;
  subscription?: SubscriptionInfo | null;
}

/* ---------- Payload types (only the fields we use) ---------- */

export interface WaText {
  body: string;
}

export interface WaInboundMessage {
  from: string; // customer wa_id
  id: string;
  timestamp: string; // unix seconds
  type: string;
  text?: WaText;
}

// Sent from the WhatsApp Business app on the owner's phone (coexistence).
export interface WaEcho {
  from: string; // business number
  to: string; // customer wa_id
  id: string;
  timestamp: string;
  type: string;
  text?: WaText;
}

export interface WaChangeValue {
  metadata?: { phone_number_id?: string; display_phone_number?: string };
  contacts?: { wa_id: string; profile?: { name?: string } }[];
  messages?: WaInboundMessage[];
  message_echoes?: WaEcho[];
}

export interface WaWebhookPayload {
  object?: string;
  entry?: { id: string; changes?: { field: string; value: WaChangeValue }[] }[];
}
