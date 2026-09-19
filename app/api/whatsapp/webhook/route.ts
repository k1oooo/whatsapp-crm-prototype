import { after, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { processPayload, verifySignature, type WaWebhookPayload } from "@/lib/whatsapp";

export const runtime = "nodejs";

// Meta calls this once when you register the webhook URL.
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const ok =
    p.get("hub.mode") === "subscribe" &&
    !!process.env.WHATSAPP_VERIFY_TOKEN &&
    p.get("hub.verify_token") === process.env.WHATSAPP_VERIFY_TOKEN;

  if (!ok) return new Response("Forbidden", { status: 403 });
  return new Response(p.get("hub.challenge") ?? "", { status: 200 });
}

// Meta sends every incoming message and coexistence echo here.
export async function POST(req: NextRequest) {
  const raw = await req.text();

  if (!verifySignature(raw, req.headers.get("x-hub-signature-256"))) {
    return new Response("Invalid signature", { status: 401 });
  }

  let payload: WaWebhookPayload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return new Response("Bad JSON", { status: 400 });
  }

  // Reply 200 fast so Meta does not retry, then do the slow work.
  after(async () => {
    try {
      await processPayload(createAdminClient(), payload);
    } catch (err) {
      console.error("Webhook processing failed", err);
    }
  });

  return new Response("ok", { status: 200 });
}
