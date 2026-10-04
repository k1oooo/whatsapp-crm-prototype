// Durable queue for inbound WhatsApp messages (table inbound_jobs, see 0015_reliability.sql).
//
// The webhook only stores the message and queues a job, then answers Meta. A worker claims jobs and
// does the slow part (AI, sending). So:
//  - a crash or timeout leaves the job to be retried, instead of silently losing the reply;
//  - the database allows one running job per chat, so two quick messages can not be answered twice;
//  - a second message while a job is waiting just joins it (the job reads the whole chat).
import type { SupabaseClient } from "@supabase/supabase-js";
import { alert } from "@/lib/alert";

export interface InboundJob {
  id: string;
  business_id: string;
  lead_id: string;
  attempts: number;
}

/** A chat that needs handling, whether it came through the queue or (without migration 0015) directly. */
export interface InlineJob {
  business_id: string;
  lead_id: string;
}

/**
 * True when the queue itself is missing from the database: the table (migration 0015 not applied) or
 * the claim function. That is a setup problem, not a failure of one job, so callers fall back to
 * answering inside the webhook instead of rejecting every message.
 */
export function isQueueUnavailable(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const { code, message } = err as { code?: unknown; message?: unknown };
  const text = typeof message === "string" ? message : "";
  // It must be about the queue itself. A missing leads table, say, is a different problem and must
  // not be quietly worked around.
  if (!/inbound_jobs|claim_inbound_jobs/.test(text)) return false;
  const missing = ["42P01", "PGRST205", "42883", "PGRST202"].includes(String(code));
  return missing || /does not exist|schema cache|could not find/i.test(text);
}

export const MAX_ATTEMPTS = 5;
/** Longer than the function time limit (see maxDuration in the routes), so a live worker is never reclaimed. */
export const LEASE_SECONDS = 120;
/** Wait before attempt 2, 3, 4 and 5. */
const RETRY_DELAYS_SECONDS = [30, 120, 480, 1800];

/** Queue a job for this chat. A job already waiting for it is fine: that one will see this message too. */
export async function enqueueInbound(db: SupabaseClient, businessId: string, leadId: string): Promise<void> {
  const { error } = await db.from("inbound_jobs").insert({ business_id: businessId, lead_id: leadId });
  if (error && error.code !== "23505") throw error;
}

export async function claimInboundJobs(db: SupabaseClient, limit = 5): Promise<InboundJob[]> {
  const { data, error } = await db.rpc("claim_inbound_jobs", {
    p_limit: limit,
    p_lease_seconds: LEASE_SECONDS,
    p_max_attempts: MAX_ATTEMPTS,
  });
  if (error) throw error;
  return (data ?? []) as InboundJob[];
}

async function completeJob(db: SupabaseClient, job: InboundJob): Promise<void> {
  // Only a job still running is finished: if our lease ran out and another worker took over, leave it.
  const { error } = await db
    .from("inbound_jobs")
    .update({ status: "done", locked_until: null, last_error: null, updated_at: new Date().toISOString() })
    .eq("id", job.id)
    .eq("status", "running");
  if (error) console.error("Could not mark the inbound job done", job.id, error.message);
}

/** A job failed: try again later, or give up and make sure the owner sees the chat. */
export async function failJob(
  db: SupabaseClient,
  job: InboundJob,
  err: unknown,
  now: () => number = Date.now,
): Promise<"retry" | "failed"> {
  const message = (err instanceof Error ? err.message : String(err)).slice(0, 500);
  console.error("Inbound job failed", job.id, `(attempt ${job.attempts} of ${MAX_ATTEMPTS})`, message);

  if (job.attempts >= MAX_ATTEMPTS) {
    await db
      .from("inbound_jobs")
      .update({ status: "failed", locked_until: null, last_error: message, updated_at: new Date().toISOString() })
      .eq("id", job.id)
      .eq("status", "running");
    // Do not leave the customer unanswered with nobody knowing.
    const { error } = await db
      .from("leads")
      .update({
        pending_decision: true,
        human_reason: "unsure",
        handoff_note: "The assistant could not process this customer's message after several tries. Please reply.",
        updated_at: new Date().toISOString(),
      })
      .eq("id", job.lead_id);
    if (error) console.error("Could not flag the lead after a failed job", job.lead_id, error.message);
    // A customer is waiting and the assistant has given up: tell a human (one message per outage, not per job).
    await alert(
      "inbound_job.failed",
      `A customer message could not be processed after ${MAX_ATTEMPTS} tries (job ${job.id}). The chat is flagged "Needs you". Last error: ${message.slice(0, 160)}`,
      { fields: { jobId: job.id, leadId: job.lead_id, attempts: job.attempts } },
    );
    return "failed";
  }

  const delay = RETRY_DELAYS_SECONDS[Math.min(job.attempts - 1, RETRY_DELAYS_SECONDS.length - 1)];
  const { error } = await db
    .from("inbound_jobs")
    .update({
      status: "queued",
      run_after: new Date(now() + delay * 1000).toISOString(),
      locked_until: null,
      last_error: message,
      updated_at: new Date().toISOString(),
    })
    .eq("id", job.id)
    .eq("status", "running");
  if (error?.code === "23505") {
    // A newer message queued a job for this chat meanwhile. That job will read the whole chat, so this one is redundant.
    await db
      .from("inbound_jobs")
      .update({ status: "superseded", locked_until: null, last_error: message, updated_at: new Date().toISOString() })
      .eq("id", job.id)
      .eq("status", "running");
  } else if (error) {
    console.error("Could not schedule a retry", job.id, error.message);
  }
  return "retry";
}

export interface DrainOptions {
  /** Jobs claimed per round. */
  limit?: number;
  /** Stop starting new rounds after this long. Keep it under the function's time limit. */
  budgetMs?: number;
  now?: () => number;
}

/**
 * Claim and run jobs until none are due or the time budget is used. Jobs in one round are for
 * different chats (the database guarantees it), so they run side by side.
 */
export async function drainInboundJobs(
  db: SupabaseClient,
  handler: (job: InboundJob) => Promise<void>,
  options: DrainOptions = {},
): Promise<{ done: number; retried: number; failed: number }> {
  const { limit = 5, budgetMs = 45_000, now = Date.now } = options;
  const deadline = now() + budgetMs;
  const summary = { done: 0, retried: 0, failed: 0 };

  while (now() < deadline) {
    const jobs = await claimInboundJobs(db, limit);
    if (jobs.length === 0) break;

    await Promise.all(
      jobs.map(async (job) => {
        try {
          await handler(job);
          await completeJob(db, job);
          summary.done++;
        } catch (err) {
          const outcome = await failJob(db, job, err, now);
          if (outcome === "failed") summary.failed++;
          else summary.retried++;
        }
      }),
    );
  }
  return summary;
}

/** Drop finished jobs after a while, so the table stays small. */
export async function deleteFinishedJobs(db: SupabaseClient, olderThanDays = 7): Promise<void> {
  const cutoff = new Date(Date.now() - olderThanDays * 86_400_000).toISOString();
  const { error } = await db
    .from("inbound_jobs")
    .delete()
    .in("status", ["done", "superseded", "failed"])
    .lt("updated_at", cutoff);
  if (error) console.error("Could not clean up finished inbound jobs", error.message);
}
