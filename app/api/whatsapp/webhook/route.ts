import { safeEqual } from "@/lib/cron-auth";
import { after, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyWebhook } from "@/lib/webhook-auth";
import { ingestPayload, runInboundWork, type WaWebhookPayload } from "@/lib/whatsapp";

export const runtime = "nodejs";
// The background work after the reply (AI and sending) runs inside this limit.
export const maxDuration = 60;

// Meta calls this once when you (or a business using their own Meta app) register the webhook
// URL. The shared deployment token covers the common case; a business with their own Meta app
// picks their own verify token in Settings > Connect WhatsApp, so it's checked here too.
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const token = p.get("hub.verify_token");

  if (p.get("hub.mode") !== "subscribe" || !token) {
    return new Response("Forbidden", { status: 403 });
  }

  const sharedMatch = !!process.env.WHATSAPP_VERIFY_TOKEN && safeEqual(token, process.env.WHATSAPP_VERIFY_TOKEN);

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
// secret of whichever Meta app sent it, so each phone number it mentions is checked against that
// business's secret (see lib/webhook-auth.ts) before anything in it is trusted.
export async function POST(req: NextRequest) {
  const raw = await req.text();

  let payload: WaWebhookPayload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return new Response("Bad JSON", { status: 400 });
  }

  const admin = createAdminClient();

  // Every phone number in the payload must verify against its own business's secret, not just the first.
  if (!(await verifyWebhook(admin, raw, req.headers.get("x-hub-signature-256"), payload))) {
    return new Response("Invalid signature", { status: 401 });
  }

  // Store the messages and queue the work BEFORE answering. If this fails, answer 500 so Meta sends
  // the delivery again: the messages are deduplicated, and one nobody has answered yet is queued
  // again. (Answering 200 first and storing later, as before, lost the message on a crash.)
  let inline: Awaited<ReturnType<typeof ingestPayload>>["inline"];
  try {
    ({ inline } = await ingestPayload(admin, payload));
  } catch (err) {
    console.error("Webhook ingest failed", err);
    return new Response("Temporary failure", { status: 500 });
  }

  // Then answer Meta and do the slow part (AI, sending) in the background. If this is cut short, the
  // job stays in the queue and is retried (here on the next webhook, or by the cron sweeper).
  after(async () => {
    try {
      await runInboundWork(admin, inline, { budgetMs: 45_000 });
    } catch (err) {
      console.error("Inbound worker failed", err);
    }
  });

  return new Response("ok", { status: 200 });
}
