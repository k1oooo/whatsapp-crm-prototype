import { runDueFollowUps } from "@/lib/follow-ups";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

// Called once a day by Vercel Cron (see vercel.json). Sends every follow-up that is due.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const summary = await runDueFollowUps(createAdminClient());
  return Response.json(summary);
}
