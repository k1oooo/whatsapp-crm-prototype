// Checks done when an owner connects a WhatsApp number in Settings.

export type AccessCheck = { ok: true } | { ok: false; error: string };

/**
 * Whether this signed-in user may claim a number using the deployment's shared WHATSAPP_ACCESS_TOKEN.
 * That token reaches the operator's own numbers, so a self-serve tenant who typed one of those IDs
 * would pass the check below. Only the user ids listed in WHATSAPP_SHARED_TOKEN_OWNER_IDS (comma
 * separated Supabase auth user ids, the operator's own accounts) may rely on it. Everyone else has
 * to bring a token of their own, or connect through Embedded Signup.
 */
export function isSharedTokenOwner(userId: string): boolean {
  const allowed = (process.env.WHATSAPP_SHARED_TOKEN_OWNER_IDS ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  return allowed.includes(userId);
}

/**
 * Ask the Graph API whether this access token can see this phone number ID. A token only reaches
 * numbers that belong to its own WhatsApp Business Account, so a 200 for the ID proves the owner is
 * allowed to use it. Without this check anyone could save a number they do not own, take the
 * webhook traffic for it, or block the real owner from connecting it.
 *
 * Fails closed: if WhatsApp cannot be reached, the number is not saved.
 */
export async function checkPhoneNumberAccess(
  phoneNumberId: string,
  accessToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<AccessCheck> {
  if (!/^\d{5,25}$/.test(phoneNumberId)) {
    return { ok: false, error: "The phone number ID should be digits only. Copy it from WhatsApp Manager." };
  }

  const version = process.env.WHATSAPP_API_VERSION || "v23.0";
  let res: Response;
  try {
    res = await fetchImpl(
      `https://graph.facebook.com/${version}/${phoneNumberId}?fields=id,display_phone_number`,
      { headers: { authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(8000) },
    );
  } catch {
    return { ok: false, error: "Could not reach WhatsApp to check this number. Try again in a moment." };
  }

  if (res.status >= 500 || res.status === 429) {
    return { ok: false, error: "WhatsApp is busy right now, so the number could not be checked. Try again in a moment." };
  }
  if (!res.ok) {
    return {
      ok: false,
      error: "WhatsApp does not accept this phone number ID with that access token. Check both in WhatsApp Manager.",
    };
  }

  const json = (await res.json().catch(() => null)) as { id?: string } | null;
  if (!json || String(json.id) !== phoneNumberId) {
    return { ok: false, error: "WhatsApp returned a different number than the one you entered. Check the ID." };
  }
  return { ok: true };
}
