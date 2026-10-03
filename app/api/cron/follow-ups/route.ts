import { isCronAuthorized } from "@/lib/cron-auth";
import { runDueFollowUps } from "@/lib/follow-ups";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 60;

// Called once a day by Vercel Cron (see vercel.json). Sends every follow-up that is due.
export async function GET(req: Request) {
  if (!isCronAuthorized(req)) return new Response("Unauthorized", { status: 401 });

  const summary = await runDueFollowUps(createAdminClient());
  return Response.json(summary);
}
