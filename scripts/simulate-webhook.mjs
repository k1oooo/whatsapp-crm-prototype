// Sends a signed fake WhatsApp webhook to your local server, so you can test for free.
// Usage: node --env-file=.env.local scripts/simulate-webhook.mjs "Hi kak, ada buat kek?" [in|out|image]
// "image" sends a photo with no text, like a payment receipt.
import crypto from "node:crypto";

const text = process.argv[2] ?? "Hi kak, ada buat kek birthday tak?";
const direction = process.argv[3] ?? "in";
const phoneNumberId = process.env.SIM_PHONE_NUMBER_ID ?? "TEST_PHONE_NUMBER_ID";
const customer = process.env.SIM_CUSTOMER ?? "60123456789";
const url = process.env.SIM_URL ?? "http://localhost:3000/api/whatsapp/webhook";
const secret = process.env.WHATSAPP_APP_SECRET;

if (!secret) {
  console.error("Set WHATSAPP_APP_SECRET in .env.local first.");
  process.exit(1);
}

const ts = String(Math.floor(Date.now() / 1000));
const id = `wamid.SIM${crypto.randomUUID()}`;

const value =
  direction === "image"
    ? {
        messaging_product: "whatsapp",
        metadata: { phone_number_id: phoneNumberId },
        contacts: [{ wa_id: customer, profile: { name: "Test Customer" } }],
        messages: [{ from: customer, id, timestamp: ts, type: "image", image: { id: "SIM_IMAGE" } }],
      }
    : direction === "in"
    ? {
        messaging_product: "whatsapp",
        metadata: { phone_number_id: phoneNumberId },
        contacts: [{ wa_id: customer, profile: { name: "Test Customer" } }],
        messages: [{ from: customer, id, timestamp: ts, type: "text", text: { body: text } }],
      }
    : {
        messaging_product: "whatsapp",
        metadata: { phone_number_id: phoneNumberId },
        message_echoes: [
          { from: "60111111111", to: customer, id, timestamp: ts, type: "text", text: { body: text } },
        ],
      };

const body = JSON.stringify({
  object: "whatsapp_business_account",
  entry: [
    {
      id: "SIM_WABA",
      changes: [{ field: direction === "out" ? "smb_message_echoes" : "messages", value }],
    },
  ],
});

const signature = "sha256=" + crypto.createHmac("sha256", secret).update(body).digest("hex");

const res = await fetch(url, {
  method: "POST",
  headers: { "content-type": "application/json", "x-hub-signature-256": signature },
  body,
});
console.log(res.status, await res.text());
