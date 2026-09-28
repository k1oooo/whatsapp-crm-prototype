import crypto from "node:crypto";
import type { WaWebhookPayload } from "@/lib/whatsapp";

let seq = 0;
/** A unique-ish wamid, unless you pass your own (e.g. to simulate a Meta retry). */
export function waMessageId(id?: string): string {
  return id ?? `wamid.TEST${Date.now()}.${seq++}`;
}

/** An inbound text message from a customer, shaped like a real WhatsApp Cloud API webhook. */
export function inboundTextPayload(args: {
  phoneNumberId: string;
  from: string;
  body: string;
  messageId?: string;
  name?: string;
  sentAt?: Date;
}): WaWebhookPayload {
  const { phoneNumberId, from, body, name = "Test Customer", sentAt = new Date() } = args;
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "TEST_WABA",
        changes: [
          {
            field: "messages",
            value: {
              metadata: { phone_number_id: phoneNumberId, display_phone_number: "60000000000" },
              contacts: [{ wa_id: from, profile: { name } }],
              messages: [
                {
                  from,
                  id: waMessageId(args.messageId),
                  timestamp: String(Math.floor(sentAt.getTime() / 1000)),
                  type: "text",
                  text: { body },
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

/** An inbound photo/document/voice note: no text, just a media placeholder. */
export function inboundMediaPayload(args: {
  phoneNumberId: string;
  from: string;
  mediaType?: "image" | "document" | "audio";
  messageId?: string;
  name?: string;
}): WaWebhookPayload {
  const { phoneNumberId, from, mediaType = "image", name = "Test Customer" } = args;
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "TEST_WABA",
        changes: [
          {
            field: "messages",
            value: {
              metadata: { phone_number_id: phoneNumberId, display_phone_number: "60000000000" },
              contacts: [{ wa_id: from, profile: { name } }],
              messages: [
                {
                  from,
                  id: waMessageId(args.messageId),
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  type: mediaType,
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

/** Sign a raw JSON body the same way Meta signs webhook deliveries. */
export function signPayload(rawBody: string, secret: string): string {
  return "sha256=" + crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
}
