// Sending WhatsApp messages through the Cloud API.
// Default is dry mode: nothing is sent, so you can test everything with the simulator.
// To send for real, set WHATSAPP_SEND_MODE=live and WHATSAPP_ACCESS_TOKEN.

export interface SendResult {
  id: string;
  dry: boolean;
}

export function sendMode(): "live" | "dry" {
  return process.env.WHATSAPP_SEND_MODE === "live" && process.env.WHATSAPP_ACCESS_TOKEN
    ? "live"
    : "dry";
}

export async function sendWhatsAppText(
  phoneNumberId: string,
  to: string,
  body: string,
): Promise<SendResult> {
  if (sendMode() === "dry") {
    return { id: `dry.${crypto.randomUUID()}`, dry: true };
  }

  const version = process.env.WHATSAPP_API_VERSION || "v23.0";
  const res = await fetch(`https://graph.facebook.com/${version}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body },
    }),
  });

  if (!res.ok) {
    throw new Error(`WhatsApp send failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  }
  const json = await res.json();
  const id = json.messages?.[0]?.id;
  if (!id) throw new Error("WhatsApp send returned no message id");
  return { id, dry: false };
}
