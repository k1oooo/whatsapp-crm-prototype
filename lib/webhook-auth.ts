// Webhook authentication. Kept apart from the route so it can be tested without an HTTP request.
import type { SupabaseClient } from "@supabase/supabase-js";
import { readSecret } from "@/lib/secrets";
import { verifySignature, type WaWebhookPayload } from "@/lib/whatsapp";

// A real delivery comes from one Meta app and carries one number, or a few numbers of one WABA.
// The lookup below runs BEFORE the signature is trusted, so cap it: an unsigned request must not
// be able to make us run an unbounded number of queries.
export const MAX_PHONE_NUMBER_IDS = 5;

/** Every distinct phone_number_id the payload claims to be about, across all entries and changes. */
export function phoneNumberIdsOf(payload: WaWebhookPayload): string[] {
  const ids = new Set<string>();
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const id = change.value?.metadata?.phone_number_id;
      if (typeof id === "string" && id) ids.add(id);
    }
  }
  return [...ids];
}

/**
 * The app secret that must have signed a delivery for this phone number:
 *  - the business's own secret, if it set one;
 *  - the deployment's shared secret, only for a business that has NO credentials of its own;
 *  - nothing (so verification fails) for a business that brought its own Meta app credentials but
 *    no app secret, or when the lookup failed. Failing closed on an error is deliberate: Meta
 *    retries a rejected delivery, so a transient database error loses nothing.
 */
async function secretFor(db: SupabaseClient, phoneNumberId: string, shared: string | undefined) {
  const { data: business, error } = await db
    .from("businesses")
    .select("wa_app_secret, wa_access_token, wa_verify_token")
    .eq("wa_phone_number_id", phoneNumberId)
    .maybeSingle();
  if (error) {
    console.error("Webhook secret lookup failed", error.message);
    return undefined;
  }
  if (!business) return shared; // not ours: it is ignored later, but the signature must still be genuine
  // Stored encrypted. If it is there but cannot be read, fail closed rather than use the shared secret.
  if (business.wa_app_secret) return readSecret(business.wa_app_secret as string, "app secret") ?? undefined;
  const hasOwnCredentials = !!(business.wa_access_token || business.wa_verify_token);
  return hasOwnCredentials ? undefined : shared;
}

/**
 * True only when the signature is valid for EVERY phone number in the payload.
 *
 * processPayload acts on every change in the payload, so checking just the first one lets a
 * tenant sign a payload with their own secret and slip in a change that targets someone else's
 * (non-secret) phone_number_id. Each number's own secret must verify the same signature.
 */
export async function verifyWebhook(
  db: SupabaseClient,
  rawBody: string,
  signatureHeader: string | null,
  payload: WaWebhookPayload,
): Promise<boolean> {
  const shared = process.env.WHATSAPP_APP_SECRET;
  const ids = phoneNumberIdsOf(payload);
  if (ids.length === 0) return verifySignature(rawBody, signatureHeader, shared);
  if (ids.length > MAX_PHONE_NUMBER_IDS) return false;

  for (const id of ids) {
    if (!verifySignature(rawBody, signatureHeader, await secretFor(db, id, shared))) return false;
  }
  return true;
}
