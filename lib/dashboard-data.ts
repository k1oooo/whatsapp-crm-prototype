import type { SupabaseClient } from "@supabase/supabase-js";
import { log } from "@/lib/log";
import { REASON_LABEL, rm, STAGES, STAGE_LABEL, type Stage } from "@/lib/leads";

/** What an order is worth: the computed total if there is one, else the price on the lead. */
export function orderValue(l: { order_total_myr?: number | string | null; quoted_price_myr: number | null }): number {
  if (l.order_total_myr != null) {
    const n = Number(l.order_total_myr);
    if (Number.isFinite(n)) return n;
  }
  return l.quoted_price_myr ?? 0;
}

const DASHBOARD_LEAD_COLUMNS =
  "id, name, wa_contact_number, stage, order_status, quoted_price_myr, pending_decision, human_reason, last_inbound_at, paid_at, created_at";

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
  /** The exact total the server computed from the menu (0015). Revenue uses this when it is there. */
  order_total_myr?: number | string | null;
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
 * The same numbers worked out in JavaScript from the raw rows. This is the fallback for a database
 * that has not had migration 0016, and the reference the SQL version is checked against. It reads at
 * most 1000 recent messages, which is the limit the SQL version removes.
 *
 * Everything the dashboard overview needs, in three queries. Two windows are compared throughout
 * (this week vs. the 7 days before it) so the page can show a trend, not just a snapshot.
 * Read-only and RLS-scoped to the signed-in owner's business, same as every other dashboard page.
 */
export async function getDashboardDataFromRows(supabase: SupabaseClient): Promise<DashboardData> {
  const now = Date.now();
  const weekAgo = new Date(now - WEEK_MS).toISOString();
  const twoWeeksAgo = new Date(now - 2 * WEEK_MS).toISOString();
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const startOfTomorrow = new Date(startOfToday.getTime() + DAY_MS);

  const [leadsRes, messagesRes, followUpsRes, feedbackRes] = await Promise.all([
    // order_total_myr exists from migration 0015. Before it, fall back to the older column set.
    supabase
      .from("leads")
      .select(`${DASHBOARD_LEAD_COLUMNS}, order_total_myr`)
      .then((res) => (res.error ? supabase.from("leads").select(DASHBOARD_LEAD_COLUMNS) : res)),
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
  const revenueThisWeek = paidThisWeek.reduce((sum, l) => sum + orderValue(l), 0);
  const revenueLastWeek = paidLastWeek.reduce((sum, l) => sum + orderValue(l), 0);

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
    .sort((a, b) => orderValue(b) - orderValue(a))
    .slice(0, 3)
    .map((l) => ({ name: nameFor(l), amount: orderValue(l) }));
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


/** What dashboard_stats() (migration 0016) returns: raw numbers, no labels. */
export interface DashboardStats {
  needs_you: number;
  waiting_for_payment: number;
  paid_orders: number;
  pipeline: Record<string, number>;
  attention: { id: string; name: string | null; number: string; reason: string | null; since: string }[];
  revenue_this: number;
  revenue_last: number;
  paid_count_this: number;
  created_this: number;
  created_this_paid: number;
  created_last: number;
  created_last_paid: number;
  top_orders: { name: string | null; number: string; amount: number }[];
  avg_first_reply_seconds: number | null;
  customer_msgs_this: number;
  customer_msgs_last: number;
  outbound_this: number;
  bot_this: number;
  outbound_last: number;
  bot_last: number;
  due_today_feedback: number;
  due_today_reorder: number;
  feedback_avg: number | null;
  feedback_count: number;
  activity: {
    id: string;
    lead_id: string;
    source: MessageRow["source"];
    snippet: string | null;
    at: string;
    name: string | null;
    number: string | null;
  }[];
}

const num = (v: unknown) => (v == null ? 0 : Number(v));
const numOrNull = (v: unknown) => (v == null ? null : Number(v));

/** Turn the SQL numbers into what the page shows: names, "18 min", percentages. */
export function dashboardFromStats(st: DashboardStats): DashboardData {
  const nameOf = (name: string | null, number: string | null) => name ?? (number ? `+${number}` : "A customer");
  const pct = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : null);

  const revenueThisWeek = num(st.revenue_this);
  const revenueLastWeek = num(st.revenue_last);
  const conversionThisWeekPct = pct(num(st.created_this_paid), num(st.created_this));
  const conversionLastWeekPct = pct(num(st.created_last_paid), num(st.created_last));

  return {
    needsYou: num(st.needs_you),
    waitingForPayment: num(st.waiting_for_payment),
    paidOrders: num(st.paid_orders),
    attention: (st.attention ?? []).map((a) => ({
      id: a.id,
      name: nameOf(a.name, a.number),
      reason: a.reason ? (REASON_LABEL[a.reason] ?? a.reason) : "needs your input",
      waiting: agoLabel(a.since),
    })),
    pipeline: STAGES.map((stage) => ({ stage, label: STAGE_LABEL[stage], count: num(st.pipeline?.[stage]) })),
    revenueThisWeek,
    revenueChangePct: pctChange(revenueThisWeek, revenueLastWeek),
    conversionThisWeekPct,
    conversionChangePts:
      conversionThisWeekPct !== null && conversionLastWeekPct !== null ? conversionThisWeekPct - conversionLastWeekPct : null,
    avgFirstReplySeconds: numOrNull(st.avg_first_reply_seconds),
    assistantSharePct: pct(num(st.bot_this), num(st.outbound_this)),
    assistantShareLastWeekPct: pct(num(st.bot_last), num(st.outbound_last)),
    messagesGrowthPct: pctChange(num(st.customer_msgs_this), num(st.customer_msgs_last)),
    topOrdersThisWeek: (st.top_orders ?? []).map((o) => ({ name: nameOf(o.name, o.number), amount: num(o.amount) })),
    avgOrderValueThisWeek: num(st.paid_count_this) ? revenueThisWeek / num(st.paid_count_this) : null,
    followUpsDueToday: { feedback: num(st.due_today_feedback), reorder: num(st.due_today_reorder) },
    feedbackAverage: numOrNull(st.feedback_avg),
    feedbackCount: num(st.feedback_count),
    activity: (st.activity ?? []).map((m) => ({
      id: m.id,
      name: nameOf(m.name, m.number),
      action: ACTION_LABEL[m.source],
      snippet: m.snippet ? (m.snippet.length > 60 ? `${m.snippet.slice(0, 60)}…` : m.snippet) : null,
      time: agoLabel(m.at),
      source: m.source,
    })),
  };
}

/**
 * Everything the dashboard overview needs. The numbers come from one SQL function, so they stay right
 * however many messages there are. Falls back to the older JavaScript version if that function is not
 * there yet (migration 0016 not applied), so an out-of-date database shows a dashboard, not an error.
 */
export async function getDashboardData(supabase: SupabaseClient): Promise<DashboardData> {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const startOfTomorrow = new Date(startOfToday.getTime() + DAY_MS);

  const { data, error } = await supabase.rpc("dashboard_stats", {
    p_today_start: startOfToday.toISOString(),
    p_tomorrow_start: startOfTomorrow.toISOString(),
  });
  if (error || !data) {
    log.warn("dashboard.stats_fallback", {}, error ?? new Error("no data"));
    return getDashboardDataFromRows(supabase);
  }
  return dashboardFromStats(data as DashboardStats);
}
