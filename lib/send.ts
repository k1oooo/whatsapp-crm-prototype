// Sending WhatsApp messages through the Cloud API.
// Default is dry mode: nothing is sent, so you can test everything with the simulator.
// To send for real: set WHATSAPP_SEND_MODE=live, and either put an access token on the
// business (Settings > Connect WhatsApp) or set the shared WHATSAPP_ACCESS_TOKEN env var.

import { fetchWithRetry, retryOnlyRateLimit } from "@/lib/http";
import { readSecret } from "@/lib/secrets";

export interface SendResult {
  id: string;
  dry: boolean;
}

/**
 * The token actually used for a business: their own (stored encrypted, see lib/secrets.ts), or the
 * deployment's shared one. A business that has its own token that cannot be read gets NO token, never
 * the shared one: that would send as a different tenant's WhatsApp account.
 */
export function resolveToken(businessToken?: string | null): string | undefined {
  if (businessToken) return readSecret(businessToken, "access token") ?? undefined;
  return process.env.WHATSAPP_ACCESS_TOKEN;
}

export function sendMode(businessToken?: string | null): "live" | "dry" {
  return process.env.WHATSAPP_SEND_MODE === "live" && !!resolveToken(businessToken) ? "live" : "dry";
}

/** In live mode, a stored token that cannot be decrypted must fail loudly, not fall back to a fake dry send. */
function assertTokenReadable(businessToken?: string | null) {
  if (process.env.WHATSAPP_SEND_MODE === "live" && businessToken && !resolveToken(businessToken)) {
    throw new Error("This business's WhatsApp access token could not be read (check WA_SECRETS_KEY).");
  }
}

export async function sendWhatsAppText(
  phoneNumberId: string,
  to: string,
  body: string,
  accessToken?: string | null,
): Promise<SendResult> {
  assertTokenReadable(accessToken);
  const token = resolveToken(accessToken);
  if (sendMode(accessToken) === "dry") {
    return { id: `dry.${crypto.randomUUID()}`, dry: true };
  }

  const version = process.env.WHATSAPP_API_VERSION || "v23.0";
  // The Cloud API has no idempotency key, so a send is repeated only after a 429 (which says it was
  // not processed). A timeout or 5xx is ambiguous: repeating could message the customer twice.
  const res = await fetchWithRetry(
    `https://graph.facebook.com/${version}/${phoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body },
      }),
    },
    { timeoutMs: 15_000, retries: 2, shouldRetry: retryOnlyRateLimit },
  );

  if (!res.ok) {
    throw new Error(`WhatsApp send failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  }
  const json = await res.json();
  const id = json.messages?.[0]?.id;
  if (!id) throw new Error("WhatsApp send returned no message id");
  return { id, dry: false };
}

/**
 * Send an approved template. Needed for any message the business starts, more than 24 hours after
 * the customer last wrote. Templates are created and approved in WhatsApp Manager.
 */
export async function sendWhatsAppTemplate(
  phoneNumberId: string,
  to: string,
  templateName: string,
  languageCode: string,
  params: string[],
  accessToken?: string | null,
): Promise<SendResult> {
  assertTokenReadable(accessToken);
  const token = resolveToken(accessToken);
  if (sendMode(accessToken) === "dry") {
    return { id: `dry.${crypto.randomUUID()}`, dry: true };
  }
  if (!templateName) throw new Error("No template name set for this follow-up");

  const version = process.env.WHATSAPP_API_VERSION || "v23.0";
  const res = await fetchWithRetry(
    `https://graph.facebook.com/${version}/${phoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "template",
        template: {
          name: templateName,
          language: { code: languageCode },
          components: params.length
            ? [{ type: "body", parameters: params.map((text) => ({ type: "text", text })) }]
            : [],
        },
      }),
    },
    { timeoutMs: 15_000, retries: 2, shouldRetry: retryOnlyRateLimit },
  );

  if (!res.ok) {
    throw new Error(`WhatsApp template send failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  }
  const json = await res.json();
  const id = json.messages?.[0]?.id;
  if (!id) throw new Error("WhatsApp template send returned no message id");
  return { id, dry: false };
}
