import { after, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { processPayload, verifySignature, type WaWebhookPayload } from "@/lib/whatsapp";

export const runtime = "nodejs";

// Meta calls this once when you (or a business using their own Meta app) register the webhook
// URL. The shared deployment token covers the common case; a business with their own Meta app
// picks their own verify token in Settings > Connect WhatsApp, so it's checked here too.
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const token = p.get("hub.verify_token");

  if (p.get("hub.mode") !== "subscribe" || !token) {
    return new Response("Forbidden", { status: 403 });
  }

  const sharedMatch = !!process.env.WHATSAPP_VERIFY_TOKEN && token === process.env.WHATSAPP_VERIFY_TOKEN;

  let businessMatch = false;
  if (!sharedMatch) {
    const { data } = await createAdminClient()
      .from("businesses")
      .select("id")
      .eq("wa_verify_token", token)
      .maybeSingle();
    businessMatch = !!data;
  }

  if (!sharedMatch && !businessMatch) return new Response("Forbidden", { status: 403 });
  return new Response(p.get("hub.challenge") ?? "", { status: 200 });
}

// Meta sends every incoming message and coexistence echo here. A payload is signed with the
// secret of whichever Meta app sent it, so we peek at the first entry to find out which
// business (and therefore which secret) this is, before trusting the signature.
export async function POST(req: NextRequest) {
  const raw = await req.text();

  let payload: WaWebhookPayload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return new Response("Bad JSON", { status: 400 });
  }

  const phoneNumberId = payload.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id;
  const admin = createAdminClient();

  let appSecret: string | undefined = process.env.WHATSAPP_APP_SECRET;
  if (phoneNumberId) {
    const { data: business } = await admin
      .from("businesses")
      .select("wa_app_secret")
      .eq("wa_phone_number_id", phoneNumberId)
      .maybeSingle();
    if (business?.wa_app_secret) appSecret = business.wa_app_secret;
  }

  if (!verifySignature(raw, req.headers.get("x-hub-signature-256"), appSecret)) {
    return new Response("Invalid signature", { status: 401 });
  }

  // Reply 200 fast so Meta does not retry, then do the slow work.
  after(async () => {
    try {
      await processPayload(admin, payload);
    } catch (err) {
      console.error("Webhook processing failed", err);
    }
  });

  return new Response("ok", { status: 200 });
}
