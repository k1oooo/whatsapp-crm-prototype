import type { SupabaseClient } from "@supabase/supabase-js";
import { REASON_LABEL, rm, STAGES, STAGE_LABEL, type Stage } from "@/lib/leads";

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

export interface AttentionItem {
  id: string;
  name: string;
  reason: string;
  waiting: string;
}

export interface ActivityItem {
  id: string;
  name: string;
  action: string;
  snippet: string | null;
  time: string;
  source: "customer" | "owner" | "bot" | "dashboard";
}

export interface PipelineStage {
  stage: Stage;
  label: string;
  count: number;
}

export interface OrderRow {
  name: string;
  amount: number;
}

export interface DashboardData {
  needsYou: number;
  waitingForPayment: number;
  paidOrders: number;
  attention: AttentionItem[];
  pipeline: PipelineStage[];
  revenueThisWeek: number;
  revenueChangePct: number | null;
  conversionThisWeekPct: number | null;
  conversionChangePts: number | null;
  avgFirstReplySeconds: number | null;
  assistantSharePct: number | null;
  assistantShareLastWeekPct: number | null;
  messagesGrowthPct: number | null;
  topOrdersThisWeek: OrderRow[];
  avgOrderValueThisWeek: number | null;
  followUpsDueToday: { feedback: number; reorder: number };
  feedbackAverage: number | null;
  feedbackCount: number;
  activity: ActivityItem[];
}

interface LeadRow {
  id: string;
  name: string | null;
  wa_contact_number: string;
  stage: Stage;
  order_status: string | null;
  quoted_price_myr: number | null;
  pending_decision: boolean;
  human_reason: string | null;
  last_inbound_at: string | null;
  paid_at: string | null;
  created_at: string;
}

interface MessageRow {
  id: string;
  lead_id: string;
  source: "customer" | "owner" | "bot" | "dashboard";
  body: string | null;
  created_at: string;
}

function nameFor(row: Pick<LeadRow, "name" | "wa_contact_number">): string {
  return row.name ?? `+${row.wa_contact_number}`;
}

/** "18 min", "3 hrs", "2 days". Minute-level, unlike lib/leads' day-granularity relativeDays —
 * an owner deciding whether to jump in needs to know if it's been 10 minutes or 3 hours. */
function agoLabel(iso: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr${hours === 1 ? "" : "s"}`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"}`;
}

const ACTION_LABEL: Record<MessageRow["source"], string> = {
  customer: "sent a new message",
  owner: "replied",
  bot: "assistant replied",
  dashboard: "got a note added",
};

function pctChange(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return ((current - previous) / previous) * 100;
}

/**
 * Everything the dashboard overview needs, in three queries. Two windows are compared throughout
 * (this week vs. the 7 days before it) so the page can show a trend, not just a snapshot.
 * Read-only and RLS-scoped to the signed-in owner's business, same as every other dashboard page.
 */
export async function getDashboardData(supabase: SupabaseClient): Promise<DashboardData> {
  const now = Date.now();
  const weekAgo = new Date(now - WEEK_MS).toISOString();
  const twoWeeksAgo = new Date(now - 2 * WEEK_MS).toISOString();
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const startOfTomorrow = new Date(startOfToday.getTime() + DAY_MS);

  const [leadsRes, messagesRes, followUpsRes, feedbackRes] = await Promise.all([
    supabase
      .from("leads")
      .select(
        "id, name, wa_contact_number, stage, order_status, quoted_price_myr, pending_decision, human_reason, last_inbound_at, paid_at, created_at",
      ),
    // Capped at 1000 rows / 14 days: enough for reply-time and volume stats on a small business
    // without scanning the whole message history on every dashboard load.
    supabase
      .from("messages")
      .select("id, lead_id, source, body, created_at")
      .gte("created_at", twoWeeksAgo)
      .order("created_at", { ascending: false })
      .limit(1000),
    supabase
      .from("follow_ups")
      .select("kind")
      .eq("status", "scheduled")
      .gte("due_at", startOfToday.toISOString())
      .lt("due_at", startOfTomorrow.toISOString()),
    supabase.from("feedback").select("rating"),
  ]);

  const leads = (leadsRes.data ?? []) as LeadRow[];
  const messages = (messagesRes.data ?? []) as MessageRow[];
  const dueToday = (followUpsRes.data ?? []) as { kind: string }[];
  const ratings = (feedbackRes.data ?? []) as { rating: number | null }[];

  const needsYou = leads.filter((l) => l.pending_decision).length;
  const waitingForPayment = leads.filter((l) => l.order_status === "confirmed").length;
  const paidOrders = leads.filter((l) => l.order_status === "paid").length;

  const attention = leads
    .filter((l) => l.pending_decision)
    .sort((a, b) =>
      (a.last_inbound_at ?? a.created_at).localeCompare(b.last_inbound_at ?? b.created_at),
    )
    .slice(0, 5)
    .map((l) => ({
      id: l.id,
      name: nameFor(l),
      reason: l.human_reason ? (REASON_LABEL[l.human_reason] ?? l.human_reason) : "needs your input",
      waiting: agoLabel(l.last_inbound_at ?? l.created_at),
    }));

  const pipeline: PipelineStage[] = STAGES.map((stage) => ({
    stage,
    label: STAGE_LABEL[stage],
    count: leads.filter((l) => l.stage === stage).length,
  }));

  const paidThisWeek = leads.filter(
    (l) => l.order_status === "paid" && l.paid_at && l.paid_at >= weekAgo,
  );
  const paidLastWeek = leads.filter(
    (l) => l.order_status === "paid" && l.paid_at && l.paid_at >= twoWeeksAgo && l.paid_at < weekAgo,
  );
  const revenueThisWeek = paidThisWeek.reduce((sum, l) => sum + (l.quoted_price_myr ?? 0), 0);
  const revenueLastWeek = paidLastWeek.reduce((sum, l) => sum + (l.quoted_price_myr ?? 0), 0);

  const createdThisWeek = leads.filter((l) => l.created_at >= weekAgo);
  const createdLastWeek = leads.filter(
    (l) => l.created_at >= twoWeeksAgo && l.created_at < weekAgo,
  );
  const conversionThisWeekPct = createdThisWeek.length
    ? (createdThisWeek.filter((l) => l.order_status === "paid").length / createdThisWeek.length) * 100
    : null;
  const conversionLastWeekPct = createdLastWeek.length
    ? (createdLastWeek.filter((l) => l.order_status === "paid").length / createdLastWeek.length) * 100
    : null;

  const topOrdersThisWeek = [...paidThisWeek]
    .sort((a, b) => (b.quoted_price_myr ?? 0) - (a.quoted_price_myr ?? 0))
    .slice(0, 3)
    .map((l) => ({ name: nameFor(l), amount: l.quoted_price_myr ?? 0 }));
  const avgOrderValueThisWeek = paidThisWeek.length ? revenueThisWeek / paidThisWeek.length : null;

  // First-reply time: for each lead, the gap between its first customer message and the next
  // reply from the owner or the assistant, averaged across every lead active in the last 14 days.
  const byLead = new Map<string, MessageRow[]>();
  for (const m of messages) {
    const list = byLead.get(m.lead_id) ?? [];
    list.push(m);
    byLead.set(m.lead_id, list);
  }
  const replyGaps: number[] = [];
  for (const list of byLead.values()) {
    const sorted = [...list].sort((a, b) => a.created_at.localeCompare(b.created_at));
    const firstCustomer = sorted.find((m) => m.source === "customer");
    if (!firstCustomer) continue;
    const firstReply = sorted.find(
      (m) => m.created_at > firstCustomer.created_at && (m.source === "owner" || m.source === "bot"),
    );
    if (!firstReply) continue;
    replyGaps.push(
      (new Date(firstReply.created_at).getTime() - new Date(firstCustomer.created_at).getTime()) / 1000,
    );
  }
  const avgFirstReplySeconds = replyGaps.length
    ? replyGaps.reduce((sum, s) => sum + s, 0) / replyGaps.length
    : null;

  const outboundThisWeek = messages.filter(
    (m) => m.created_at >= weekAgo && (m.source === "owner" || m.source === "bot"),
  );
  const botThisWeek = outboundThisWeek.filter((m) => m.source === "bot").length;
  const assistantSharePct = outboundThisWeek.length ? (botThisWeek / outboundThisWeek.length) * 100 : null;

  const outboundLastWeek = messages.filter(
    (m) => m.created_at >= twoWeeksAgo && m.created_at < weekAgo && (m.source === "owner" || m.source === "bot"),
  );
  const botLastWeek = outboundLastWeek.filter((m) => m.source === "bot").length;
  const assistantShareLastWeekPct = outboundLastWeek.length
    ? (botLastWeek / outboundLastWeek.length) * 100
    : null;

  const customerThisWeek = messages.filter((m) => m.source === "customer" && m.created_at >= weekAgo).length;
  const customerLastWeek = messages.filter(
    (m) => m.source === "customer" && m.created_at >= twoWeeksAgo && m.created_at < weekAgo,
  ).length;

  const followUpsDueToday = {
    feedback: dueToday.filter((f) => f.kind === "feedback").length,
    reorder: dueToday.filter((f) => f.kind === "reorder").length,
  };

  const rated = ratings.filter((r): r is { rating: number } => r.rating !== null);
  const feedbackAverage = rated.length ? rated.reduce((sum, r) => sum + r.rating, 0) / rated.length : null;

  const leadNames = new Map(leads.map((l) => [l.id, nameFor(l)]));
  const activity: ActivityItem[] = messages.slice(0, 8).map((m) => ({
    id: m.id,
    name: leadNames.get(m.lead_id) ?? "A customer",
    action: ACTION_LABEL[m.source],
    snippet: m.body ? (m.body.length > 60 ? `${m.body.slice(0, 60)}…` : m.body) : null,
    time: agoLabel(m.created_at),
    source: m.source,
  }));

  return {
    needsYou,
    waitingForPayment,
    paidOrders,
    attention,
    pipeline,
    revenueThisWeek,
    revenueChangePct: pctChange(revenueThisWeek, revenueLastWeek),
    conversionThisWeekPct,
    conversionChangePts:
      conversionThisWeekPct !== null && conversionLastWeekPct !== null
        ? conversionThisWeekPct - conversionLastWeekPct
        : null,
    avgFirstReplySeconds,
    assistantSharePct,
    assistantShareLastWeekPct,
    messagesGrowthPct: pctChange(customerThisWeek, customerLastWeek),
    topOrdersThisWeek,
    avgOrderValueThisWeek,
    followUpsDueToday,
    feedbackAverage,
    feedbackCount: ratings.length,
    activity,
  };
}

/** "RM1,234", reusing the app's existing money format. */
export const formatMoney = rm;

/** "45 sec", "3 min". */
export function formatDuration(seconds: number): string {
  if (seconds < 90) return `${Math.round(seconds)} sec`;
  return `${Math.round(seconds / 60)} min`;
}

/** "+18%" / "-4%", or null when there's no prior-week figure to compare against. */
export function formatChangePct(pct: number | null, digits = 0): string | null {
  if (pct === null) return null;
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(digits)}%`;
}
