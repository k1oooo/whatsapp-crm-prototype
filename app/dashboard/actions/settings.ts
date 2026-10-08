"use server";

// Settings: the WhatsApp connection, the assistant's settings and its on/off switch.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { TablesUpdate } from "@/lib/db-types";
import { log } from "@/lib/log";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { encryptSecret, readSecret } from "@/lib/secrets";
import { resolveToken, sendMode } from "@/lib/send";
import { checkPhoneNumberAccess, isSharedTokenOwner } from "@/lib/whatsapp-connection";
import {
  embeddedSignupConfig,
  exchangeCodeForToken,
  generatePin,
  registerPhoneNumber,
  subscribeAppToWaba,
} from "@/lib/embedded-signup";
import { META_ID } from "@/lib/embedded-signup-client";
import { type FormState } from "@/app/dashboard/actions/shared";

const NOT_SAVED =
  "Nothing was saved: no business is linked to the account you are signed in with. Sign out and sign back in, or check you are using the same account that owns the business.";

/** Save the WhatsApp phone number this business sends and receives from. */
export async function saveWhatsAppConnection(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  void _prev;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Please sign in again." };

  const phoneNumberId = String(formData.get("wa_phone_number_id") ?? "").trim();
  const ownerNumber = String(formData.get("wa_owner_number") ?? "").trim();
  if (!phoneNumberId)
    return { error: "Add the phone number ID from Meta's WhatsApp Manager." };

  const update: TablesUpdate<"businesses"> = {
    wa_phone_number_id: phoneNumberId,
    wa_owner_number: ownerNumber || null,
  };

  // Secret fields are write-only in the UI (never pre-filled with the real value), so a blank
  // box means "leave it as it is", not "clear it" — only an explicit checkbox does that.
  const own = (key: string) => {
    if (formData.get(`clear_${key}`) === "on") return null;
    const v = String(formData.get(key) ?? "").trim();
    return v || undefined;
  };
  const appSecret = own("wa_app_secret");
  const accessToken = own("wa_access_token");
  const verifyToken = own("wa_verify_token");
  // The access token and app secret are stored encrypted. The verify token stays readable: Meta
  // sends it back in the clear during webhook setup and it is looked up by value.
  try {
    if (appSecret !== undefined) update.wa_app_secret = appSecret === null ? null : encryptSecret(appSecret);
    if (accessToken !== undefined) update.wa_access_token = accessToken === null ? null : encryptSecret(accessToken);
  } catch (err) {
    console.error("Could not encrypt WhatsApp credentials", err);
    return { error: "This server is not set up to store WhatsApp credentials safely yet (WA_SECRETS_KEY is missing)." };
  }
  if (verifyToken !== undefined) update.wa_verify_token = verifyToken;

  const { data: existing } = await supabase
    .from("businesses")
    .select("wa_phone_number_id, wa_app_secret, wa_access_token, wa_verify_token, wa_connection_type")
    .eq("owner_id", user.id)
    .maybeSingle();

  // A business connected through Embedded Signup holds a token without an app secret of its own: its
  // number belongs to this deployment's Meta app. Saving only its other details (the owner number)
  // must not trip the "token needs an app secret" rule below, and typing in credentials of its own
  // switches it to the bring-your-own-app setup.
  const manualCredsGiven = appSecret !== undefined || accessToken !== undefined || verifyToken !== undefined;
  const keepEmbedded =
    existing?.wa_connection_type === "embedded" && !manualCredsGiven && phoneNumberId === existing.wa_phone_number_id;
  if (existing?.wa_connection_type === "embedded" && !keepEmbedded) {
    update.wa_connection_type = "manual";
    update.wa_waba_id = null;
    update.wa_register_pin = null;
  }

  // What the business will have saved once this form is applied.
  const after = (key: "wa_app_secret" | "wa_access_token" | "wa_verify_token") =>
    (key in update ? update[key] : (existing?.[key] as string | null | undefined)) ?? null;
  // For the live check: the token typed just now, or the one already stored (resolveToken decrypts it).
  const effectiveToken = accessToken !== undefined ? accessToken : (existing?.wa_access_token as string | null | undefined) ?? null;
  const hasToken = !!after("wa_access_token");

  // A business with its own Meta credentials is verified only against its own app secret. Without
  // it nobody could prove a message really came from Meta, so refuse to save that half-set-up state.
  if (!keepEmbedded && (hasToken || after("wa_verify_token")) && !after("wa_app_secret")) {
    return {
      error:
        "Add your Meta app secret too. Without it, messages for this number cannot be verified as coming from WhatsApp.",
    };
  }

  // Prove the owner can really use this number. Skipped in test mode, where there is no live token.
  // The proof must come from a token the owner brought. The deployment's shared token reaches the
  // operator's own numbers, so it only counts for the operator's own accounts; for anyone else it
  // would "prove" ownership of a number that is not theirs.
  const changed = phoneNumberId !== existing?.wa_phone_number_id || accessToken !== undefined;
  const mayUseSharedToken = isSharedTokenOwner(user.id);
  if (changed && !effectiveToken && !mayUseSharedToken && sendMode(null) === "live") {
    return {
      error:
        "Add your own WhatsApp access token to connect this number, or use Connect with WhatsApp. It cannot be verified without one.",
    };
  }
  const tokenToCheck = effectiveToken || mayUseSharedToken ? resolveToken(effectiveToken) : undefined;
  if (changed && tokenToCheck && sendMode(effectiveToken) === "live") {
    const check = await checkPhoneNumberAccess(phoneNumberId, tokenToCheck);
    if (!check.ok) return { error: check.error };
  }

  // .select() makes the update report the rows it changed. Without it, an update that matches nothing
  // (a different signed-in account than the business owner, say) succeeds silently and the form says
  // "Saved" while the database is untouched.
  // The connection columns are closed to the browser session (migration 0018), so the server writes
  // them. The signed-in user was verified above and the update is pinned to their own business.
  const { data: saved, error } = await createAdminClient()
    .from("businesses")
    .update(update)
    .eq("owner_id", user.id)
    .select("id");

  if (error) {
    // The phone number ID and verify token must each be unique across businesses.
    if (error.code === "23505" && error.message.includes("wa_verify_token")) {
      return {
        error:
          "That verify token is already used by another business. Pick a different one.",
      };
    }
    if (error.code === "23505") {
      return {
        error: "That phone number is already connected to another business.",
      };
    }
    return { error: "Could not save. Try again." };
  }
  if (!saved || saved.length === 0) {
    log.warn("settings.not_saved", { form: "whatsapp_connection", userId: user.id });
    return { error: NOT_SAVED };
  }

  log.info("settings.saved", { form: "whatsapp_connection", businessId: saved[0].id });
  revalidatePath("/dashboard", "layout");
  return { ok: true };
}

const EmbeddedSignupInput = z.object({
  code: z.string().min(10).max(2048),
  wabaId: z.string().regex(META_ID),
  phoneNumberId: z.string().regex(META_ID),
});

/**
 * Finish Embedded Signup for the signed-in business. The browser hands over what the Meta popup
 * returned: a one-time code (valid for 30 seconds) and the WhatsApp Business Account and phone
 * number IDs. Nothing from the browser is trusted on its own: the number is only saved if the
 * token the code produced can really see it, so one business cannot claim another's number.
 */
export async function connectWhatsAppEmbedded(input: {
  code: string;
  wabaId: string;
  phoneNumberId: string;
}): Promise<FormState> {
  const parsed = EmbeddedSignupInput.safeParse(input);
  if (!parsed.success) return { error: "WhatsApp sent back something unexpected. Click Connect and try again." };
  const { code, wabaId, phoneNumberId } = parsed.data;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Please sign in again." };

  const cfg = embeddedSignupConfig();
  if (!cfg) return { error: "This server is not set up for WhatsApp sign-in yet." };

  // Everything that can fail without touching WhatsApp runs first, so the 30 second code is not
  // spent on a request that was never going to be saved.
  try {
    encryptSecret("check");
  } catch (err) {
    console.error("Could not encrypt WhatsApp credentials", err);
    return { error: "This server is not set up to store WhatsApp credentials safely yet (WA_SECRETS_KEY is missing)." };
  }
  const { data: existing } = await supabase
    .from("businesses")
    .select("id, wa_phone_number_id, wa_register_pin")
    .eq("owner_id", user.id)
    .maybeSingle();
  if (!existing) return { error: NOT_SAVED };

  const exchanged = await exchangeCodeForToken(code, cfg);
  if (!exchanged.ok) return { error: exchanged.error };
  const token = exchanged.token;

  const access = await checkPhoneNumberAccess(phoneNumberId, token);
  if (!access.ok) return { error: access.error };

  // Refuse a number another business already holds before subscribing this WABA to the deployment's
  // app, so a failed save never leaves a WABA delivering webhooks to someone else's row.
  const admin = createAdminClient();
  const { data: holders } = await admin.from("businesses").select("owner_id").eq("wa_phone_number_id", phoneNumberId);
  if ((holders ?? []).some((h) => h.owner_id !== user.id)) {
    return { error: "That phone number is already connected to another business." };
  }

  const subscribed = await subscribeAppToWaba(wabaId, token);
  if (!subscribed.ok) return { error: subscribed.error };

  // Registering a number that already has a PIN needs that same PIN, so reconnecting the same number
  // reuses the saved one.
  const reusedPin =
    existing.wa_phone_number_id === phoneNumberId ? readSecret(existing.wa_register_pin as string | null, "register PIN") : null;
  const pin = reusedPin ?? generatePin();
  const registered = await registerPhoneNumber(phoneNumberId, token, pin);
  if (!registered.ok) return { error: registered.error };

  const { data: saved, error } = await admin
    .from("businesses")
    .update({
      wa_phone_number_id: phoneNumberId,
      wa_waba_id: wabaId,
      wa_access_token: encryptSecret(token),
      wa_register_pin: encryptSecret(pin),
      wa_connection_type: "embedded",
      // Webhooks for this number are signed with the deployment's app secret, not one of its own.
      wa_app_secret: null,
      wa_verify_token: null,
    })
    .eq("owner_id", user.id)
    .select("id");

  if (error) {
    if (error.code === "23505") return { error: "That phone number is already connected to another business." };
    log.error("settings.embedded_signup_save_failed", { userId: user.id, phoneNumberId }, error);
    return { error: "WhatsApp is connected, but saving failed. Click Connect again." };
  }
  if (!saved || saved.length === 0) {
    log.warn("settings.not_saved", { form: "whatsapp_embedded", userId: user.id });
    return { error: NOT_SAVED };
  }

  log.info("settings.saved", { form: "whatsapp_embedded", businessId: saved[0].id });
  revalidatePath("/dashboard", "layout");
  return {
    ok: true,
    notice: "WhatsApp is connected. Add a payment method in WhatsApp Manager before you send messages.",
  };
}

/** Save the auto-reply switch and the facts the assistant may use. */
export async function saveSettings(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  void _prev;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Please sign in again." };

  const text = (key: string) => {
    const v = String(formData.get(key) ?? "").trim();
    return v === "" ? null : v;
  };

  // business_facts (the knowledge base's "Other notes") is saved from the Knowledge base page,
  // not here, so this never overwrites it with an empty value.
  const replyMode =
    formData.get("reply_mode") === "approve" ? "approve" : "auto";
  const { data: saved, error } = await supabase
    .from("businesses")
    .update({
      auto_reply: formData.get("auto_reply") === "on",
      reply_mode: replyMode,
      tone_notes: text("tone_notes"),
      payment_details: text("payment_details"),
    })
    .eq("owner_id", user.id)
    .select("id");
  if (error) {
    console.error("saveSettings failed", error.code, error.message);
    return { error: `Could not save: ${error.message}` };
  }
  if (!saved || saved.length === 0) {
    log.warn("settings.not_saved", { form: "ai_settings", userId: user.id });
    return { error: NOT_SAVED };
  }
  log.info("settings.saved", { form: "ai_settings", businessId: saved[0].id });
  revalidatePath("/dashboard", "layout");
  return { ok: true };
}

/** The assistant switch: turn the assistant on or off. */
export async function toggleAutoReply(next: boolean): Promise<FormState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Please sign in again." };

  const { data: saved, error } = await supabase
    .from("businesses")
    .update({ auto_reply: next })
    .eq("owner_id", user.id)
    .select("id");
  if (error) {
    console.error("toggleAutoReply failed", error.code, error.message);
    return { error: `Could not change the assistant: ${error.message}` };
  }
  if (!saved || saved.length === 0) {
    log.warn("settings.not_saved", { form: "assistant_toggle", userId: user.id });
    return { error: NOT_SAVED };
  }
  log.info("settings.saved", { form: "assistant_toggle", businessId: saved[0].id, autoReply: next });

  revalidatePath("/dashboard", "layout");
  return { ok: true };
}
