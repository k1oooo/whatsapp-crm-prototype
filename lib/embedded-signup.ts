// Server side of Embedded Signup (the Tech Provider flow). A business clicks "Connect WhatsApp", a
// Meta popup runs under THIS deployment's Meta app, and the browser gets back a one-time code plus
// the business's WhatsApp Business Account (WABA) ID and phone number ID. The steps here turn that
// into a connected number. Meta's own order: exchange the code, subscribe the app to the WABA's
// webhooks, register the number. Every call must come from the server, never the browser.
import { randomInt } from "node:crypto";
import { log } from "@/lib/log";

export type Step<T extends object = object> = ({ ok: true } & T) | { ok: false; error: string };

export interface EmbeddedConfig {
  appId: string;
  appSecret: string;
  configId: string;
  version: string;
}

export const graphVersion = () => process.env.WHATSAPP_API_VERSION || "v23.0";

/**
 * The Embedded Signup settings, or null when this deployment is not set up for it. It needs the
 * Meta app ID and the Facebook Login for Business configuration ID (both safe to show in the
 * browser), plus the app secret, which stays on the server and is the same one that signs webhooks.
 */
export function embeddedSignupConfig(): EmbeddedConfig | null {
  const appId = process.env.NEXT_PUBLIC_META_APP_ID?.trim();
  const configId = process.env.NEXT_PUBLIC_META_ES_CONFIG_ID?.trim();
  const appSecret = process.env.WHATSAPP_APP_SECRET?.trim();
  if (!appId || !configId || !appSecret) return null;
  return { appId, appSecret, configId, version: graphVersion() };
}

/** The two-step verification PIN set when a number is registered: six random digits. */
export function generatePin(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

const TIMEOUT_MS = 10_000;

async function call(fetchImpl: typeof fetch, url: string, init: RequestInit): Promise<Response | null> {
  try {
    return await fetchImpl(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    return null;
  }
}

/** Log why Meta refused a call. Only the status and Meta's error code and text: never a token. */
async function logFailure(event: string, res: Response | null) {
  if (!res) return log.warn(event, { reason: "unreachable" });
  const body = (await res.json().catch(() => null)) as { error?: { code?: number; message?: string } } | null;
  log.warn(event, { status: res.status, graphCode: body?.error?.code, graphMessage: body?.error?.message?.slice(0, 200) });
}

const UNREACHABLE = "Could not reach WhatsApp. Try again in a moment.";

/**
 * Step 1. Swap the one-time code from the popup for the business's token. The code works once and
 * expires after 30 seconds, so this is never retried and must run right after the popup closes.
 */
export async function exchangeCodeForToken(
  code: string,
  cfg: EmbeddedConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<Step<{ token: string }>> {
  const url = new URL(`https://graph.facebook.com/${cfg.version}/oauth/access_token`);
  url.searchParams.set("client_id", cfg.appId);
  url.searchParams.set("client_secret", cfg.appSecret);
  url.searchParams.set("code", code);

  const res = await call(fetchImpl, url.toString(), {});
  if (!res) return { ok: false, error: UNREACHABLE };
  if (!res.ok) {
    await logFailure("embedded_signup.exchange_failed", res);
    return { ok: false, error: "WhatsApp did not accept the sign-in. The code expires after 30 seconds, so click Connect and try again." };
  }
  const json = (await res.json().catch(() => null)) as { access_token?: unknown } | null;
  if (typeof json?.access_token !== "string" || !json.access_token) {
    log.warn("embedded_signup.exchange_failed", { reason: "no_access_token" });
    return { ok: false, error: "WhatsApp did not return an access token. Try again." };
  }
  return { ok: true, token: json.access_token };
}

/** Step 2. Send this business's incoming messages and statuses to this app's webhook. */
export async function subscribeAppToWaba(
  wabaId: string,
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Step> {
  const res = await call(fetchImpl, `https://graph.facebook.com/${graphVersion()}/${wabaId}/subscribed_apps`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res) return { ok: false, error: UNREACHABLE };
  if (!res.ok) {
    await logFailure("embedded_signup.subscribe_failed", res);
    return { ok: false, error: "Could not turn on message delivery for this WhatsApp account. Try again." };
  }
  return { ok: true };
}

/** Step 3. Register the number with the Cloud API. The PIN becomes its two-step verification PIN. */
export async function registerPhoneNumber(
  phoneNumberId: string,
  token: string,
  pin: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Step> {
  const res = await call(fetchImpl, `https://graph.facebook.com/${graphVersion()}/${phoneNumberId}/register`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ messaging_product: "whatsapp", pin }),
  });
  if (!res) return { ok: false, error: UNREACHABLE };
  if (!res.ok) {
    await logFailure("embedded_signup.register_failed", res);
    return { ok: false, error: "Could not register this number for WhatsApp messaging. Try again." };
  }
  return { ok: true };
}
