// Browser-safe helpers for Embedded Signup. No secrets and no server-only imports in this file,
// so the sign-in button can use it. The server half is lib/embedded-signup.ts.

/** A WhatsApp phone number ID or business account ID: digits only. */
export const META_ID = /^\d{5,25}$/;

export type SessionEvent =
  | { kind: "finish"; wabaId: string; phoneNumberId: string }
  | { kind: "cancel"; step?: string; errorMessage?: string }
  | { kind: "unsupported"; event: string };

/**
 * True only for a message that really came from facebook.com. Meta's sample code checks
 * origin.endsWith("facebook.com"), which also accepts a lookalike such as evilfacebook.com.
 */
export function isFacebookOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return url.protocol === "https:" && (url.hostname === "facebook.com" || url.hostname.endsWith(".facebook.com"));
  } catch {
    return false;
  }
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);

/**
 * Read one message event sent by the Embedded Signup popup. Returns null for anything that is not an
 * Embedded Signup event (other scripts on facebook.com also post messages to the page).
 */
export function parseSessionEvent(raw: unknown): SessionEvent | null {
  let msg: unknown = raw;
  if (typeof raw === "string") {
    try {
      msg = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!msg || typeof msg !== "object") return null;
  const m = msg as { type?: unknown; event?: unknown; data?: unknown };
  if (m.type !== "WA_EMBEDDED_SIGNUP") return null;

  const data = (m.data && typeof m.data === "object" ? m.data : {}) as Record<string, unknown>;
  const event = typeof m.event === "string" ? m.event : "";

  if (event === "FINISH") {
    const wabaId = str(data.waba_id);
    const phoneNumberId = str(data.phone_number_id);
    if (!wabaId || !phoneNumberId) return { kind: "unsupported", event };
    return { kind: "finish", wabaId, phoneNumberId };
  }
  if (event === "CANCEL" || event === "ERROR") {
    return { kind: "cancel", step: str(data.current_step), errorMessage: str(data.error_message) };
  }
  // FINISH_ONLY_WABA, FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING and the others are not handled yet.
  return { kind: "unsupported", event };
}
