"use server";

// Settings: the WhatsApp connection, the assistant's settings and its on/off switch.
import { revalidatePath } from "next/cache";
import type { TablesUpdate } from "@/lib/db-types";
import { log } from "@/lib/log";
import { createClient } from "@/lib/supabase/server";
import { encryptSecret } from "@/lib/secrets";
import { resolveToken, sendMode } from "@/lib/send";
import { checkPhoneNumberAccess } from "@/lib/whatsapp-connection";
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
    .select("wa_phone_number_id, wa_app_secret, wa_access_token, wa_verify_token")
    .eq("owner_id", user.id)
    .maybeSingle();

  // What the business will have saved once this form is applied.
  const after = (key: "wa_app_secret" | "wa_access_token" | "wa_verify_token") =>
    (key in update ? update[key] : (existing?.[key] as string | null | undefined)) ?? null;
  // For the live check: the token typed just now, or the one already stored (resolveToken decrypts it).
  const effectiveToken = accessToken !== undefined ? accessToken : (existing?.wa_access_token as string | null | undefined) ?? null;
  const hasToken = !!after("wa_access_token");

  // A business with its own Meta credentials is verified only against its own app secret. Without
  // it nobody could prove a message really came from Meta, so refuse to save that half-set-up state.
  if ((hasToken || after("wa_verify_token")) && !after("wa_app_secret")) {
    return {
      error:
        "Add your Meta app secret too. Without it, messages for this number cannot be verified as coming from WhatsApp.",
    };
  }

  // Prove the owner can really use this number. Skipped in test mode, where there is no live token.
  const tokenToCheck = resolveToken(effectiveToken);
  const changed = phoneNumberId !== existing?.wa_phone_number_id || accessToken !== undefined;
  if (changed && tokenToCheck && sendMode(effectiveToken) === "live") {
    const check = await checkPhoneNumberAccess(phoneNumberId, tokenToCheck);
    if (!check.ok) return { error: check.error };
  }

  // .select() makes the update report the rows it changed. Without it, an update that matches nothing
  // (a different signed-in account than the business owner, say) succeeds silently and the form says
  // "Saved" while the database is untouched.
  const { data: saved, error } = await supabase
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
