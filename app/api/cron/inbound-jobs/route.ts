import { isCronAuthorized } from "@/lib/cron-auth";
import { deleteFinishedJobs } from "@/lib/inbound-queue";
import { createAdminClient } from "@/lib/supabase/admin";
import { runInboundWork } from "@/lib/whatsapp";

export const runtime = "nodejs";
export const maxDuration = 60;

// The safety net for the inbound queue: picks up jobs whose worker died and jobs waiting for a retry
// that no webhook has come along to run. The webhook itself also drains the queue, so this only
// matters when traffic is quiet. See vercel.json for how often it runs.
export async function GET(req: Request) {
  if (!isCronAuthorized(req)) return new Response("Unauthorized", { status: 401 });

  const db = createAdminClient();
  const summary = await runInboundWork(db, [], { budgetMs: 45_000 });
  await deleteFinishedJobs(db);
  return Response.json(summary);
}
