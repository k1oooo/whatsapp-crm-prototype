import Link from "next/link";
import {
  Activity,
  ArrowRight,
  Banknote,
  Bot,
  CircleCheck,
  Clock,
  Hourglass,
  Megaphone,
  MessageSquareText,
  Plus,
  Send,
  Star,
  TrendingDown,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  formatChangePct,
  formatDuration,
  formatMoney,
  getDashboardData,
} from "@/lib/dashboard-data";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

// Layout priority, top to bottom: (1) what needs a decision right now, (2) money and volume,
// (3) pipeline health, (4) everything else that's useful but not urgent. Everything on this page
// is real data from Supabase (see lib/dashboard-data.ts) — nothing here is hardcoded.

const SOURCE_STYLE: Record<
  "customer" | "owner" | "bot" | "dashboard",
  { icon: LucideIcon; tone: string }
> = {
  customer: { icon: MessageSquareText, tone: "bg-info text-info-foreground" },
  owner: { icon: CircleCheck, tone: "bg-secondary text-primary" },
  bot: { icon: Bot, tone: "bg-primary/10 text-primary" },
  dashboard: { icon: Banknote, tone: "bg-success text-success-foreground" },
};

function Trend({ pct, digits = 0 }: { pct: number | null; digits?: number }) {
  const label = formatChangePct(pct, digits);
  if (label === null) {
    return <p className="text-[11px] text-muted-foreground md:text-xs">No data for last week yet</p>;
  }
  const up = (pct ?? 0) >= 0;
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <p
      className={cn(
        "flex items-center gap-1 text-[11px] font-medium md:text-xs",
        up ? "text-success-foreground" : "text-warning-foreground",
      )}
    >
      <Icon className="size-3" aria-hidden />
      {label} vs last week
    </p>
  );
}

function Panel({
  title,
  action,
  children,
  className,
}: {
  title: string;
  action?: { href: string; label: string };
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("rounded-xl border bg-card p-5 shadow-sm md:p-6", className)}>
      <div className="mb-4 flex items-center justify-between gap-3 md:mb-5">
        <h2 className="font-heading text-base font-bold md:text-lg">{title}</h2>
        {action && (
          <Link
            href={action.href}
            className="flex items-center gap-1 text-xs font-medium text-primary hover:underline md:text-sm"
          >
            {action.label}
            <ArrowRight className="size-3.5" aria-hidden />
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}

function EmptyRow({ children }: { children: React.ReactNode }) {
  return <p className="py-2 text-sm text-muted-foreground">{children}</p>;
}

export default async function DashboardOverview() {
  const supabase = await createClient();
  const d = await getDashboardData(supabase);

  const tiles = [
    { label: "Need you", value: d.needsYou, icon: Hourglass, tone: "bg-warning text-warning-foreground" },
    { label: "Waiting for payment", value: d.waitingForPayment, icon: Banknote, tone: "bg-info text-info-foreground" },
    { label: "Paid orders", value: d.paidOrders, icon: CircleCheck, tone: "bg-success text-success-foreground" },
  ];

  const kpis: { label: string; value: string; trend: number | null; icon: LucideIcon }[] = [
    { label: "Revenue this week", value: formatMoney(d.revenueThisWeek), trend: d.revenueChangePct, icon: Banknote },
    {
      label: "Chats to orders",
      value: d.conversionThisWeekPct !== null ? `${d.conversionThisWeekPct.toFixed(0)}%` : "No leads yet",
      trend: d.conversionChangePts,
      icon: TrendingUp,
    },
    {
      label: "Avg. first reply",
      value: d.avgFirstReplySeconds !== null ? formatDuration(d.avgFirstReplySeconds) : "No replies yet",
      trend: null,
      icon: Clock,
    },
    {
      label: "Handled by assistant",
      value: d.assistantSharePct !== null ? `${d.assistantSharePct.toFixed(0)}%` : "No replies yet",
      trend:
        d.assistantSharePct !== null && d.assistantShareLastWeekPct !== null
          ? d.assistantSharePct - d.assistantShareLastWeekPct
          : null,
      icon: Bot,
    },
  ];

  const pipelineMax = Math.max(1, ...d.pipeline.map((p) => p.count));
  const totalLeads = d.pipeline.reduce((sum, p) => sum + p.count, 0);

  return (
    <div className="flex h-full flex-col gap-6 overflow-y-auto overflow-x-hidden scroll-stable bg-muted/20 p-4 pb-24 md:gap-8 md:p-6 md:pb-8 lg:p-8">
      {/* Header, with the two most common actions right next to it */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3 md:gap-4">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary md:size-12">
            <Activity className="size-5 md:size-6" aria-hidden />
          </span>
          <div>
            <h1 className="font-heading text-xl font-bold md:text-2xl">Overview</h1>
            <p className="text-sm text-muted-foreground md:text-base">
              A quick glance at your pipeline and orders.
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href="/dashboard/pipeline">
              <Plus className="size-4" aria-hidden />
              Add lead
            </Link>
          </Button>
          <Button asChild size="sm">
            <Link href="/dashboard/follow-ups">
              <Send className="size-4" aria-hidden />
              Broadcast
            </Link>
          </Button>
        </div>
      </div>

      {/* 1. Most important: decisions only you can make, right now. */}
      {d.attention.length > 0 && (
        <section className="rounded-xl border-2 border-warning bg-card p-5 shadow-sm md:p-6">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 font-heading text-base font-bold md:text-lg">
              <Hourglass className="size-5 text-warning-foreground" aria-hidden />
              Needs your attention
              <span className="rounded-full bg-warning px-2 py-0.5 text-xs font-bold text-warning-foreground">
                {d.attention.length}
              </span>
            </h2>
            <Link
              href="/dashboard/inbox"
              className="flex items-center gap-1 text-xs font-medium text-primary hover:underline md:text-sm"
            >
              Open inbox
              <ArrowRight className="size-3.5" aria-hidden />
            </Link>
          </div>
          <ul className="flex flex-col divide-y">
            {d.attention.map((a) => (
              <li key={a.id}>
                <Link
                  href="/dashboard/inbox"
                  className="-mx-2 flex flex-col gap-1 rounded-lg px-2 py-3 transition-colors first:pt-0 last:pb-0 hover:bg-accent sm:flex-row sm:items-center sm:justify-between sm:gap-4"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">{a.name}</p>
                    <p className="text-xs capitalize text-muted-foreground md:text-sm">{a.reason}</p>
                  </div>
                  <span className="flex shrink-0 items-center gap-1.5 text-xs text-warning-foreground md:text-sm">
                    <Hourglass className="size-3.5" aria-hidden />
                    Waiting {a.waiting}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 2. Money and volume: the numbers an owner checks first. */}
      <ul className="grid w-full grid-cols-1 gap-4 sm:grid-cols-3">
        {tiles.map(({ label, value, icon: Icon, tone }) => (
          <li key={label} className="flex items-center gap-4 rounded-xl border bg-card p-5 shadow-sm md:p-6">
            <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-xl md:size-12", tone)}>
              <Icon className="size-5 md:size-6" aria-hidden />
            </span>
            <div>
              <p className="text-xs font-medium text-muted-foreground md:text-sm">{label}</p>
              <p className="font-heading text-2xl font-bold md:text-3xl">{value}</p>
            </div>
          </li>
        ))}
      </ul>

      <ul className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4">
        {kpis.map(({ label, value, trend, icon: Icon }) => (
          <li key={label} className="flex flex-col gap-2 rounded-xl border bg-card p-4 shadow-sm md:p-5">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground md:text-sm">{label}</p>
              <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            </div>
            <p className="font-heading text-xl font-bold md:text-2xl">{value}</p>
            <Trend pct={trend} />
          </li>
        ))}
      </ul>

      {/* 3. Pipeline health and what's moved recently. */}
      <div className="grid grid-cols-1 gap-4 md:gap-6 lg:grid-cols-3">
        <Panel title="Pipeline" action={{ href: "/dashboard/pipeline", label: "View" }} className="lg:col-span-1">
          {totalLeads === 0 ? (
            <EmptyRow>No leads yet. They&apos;ll show up here as customers message you.</EmptyRow>
          ) : (
            <ul className="flex flex-col gap-3">
              {d.pipeline.map((p) => (
                <li key={p.stage}>
                  <div className="mb-1 flex justify-between text-xs md:text-sm">
                    <span className="text-muted-foreground">{p.label}</span>
                    <span className="font-semibold">{p.count}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary/60"
                      style={{ width: `${(p.count / pipelineMax) * 100}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Recent activity" className="lg:col-span-2">
          {d.activity.length === 0 ? (
            <EmptyRow>Nothing in the last two weeks yet.</EmptyRow>
          ) : (
            <ul className="flex flex-col gap-4 md:gap-5">
              {d.activity.map((item) => {
                const { icon: Icon, tone } = SOURCE_STYLE[item.source];
                return (
                  <li key={item.id} className="flex items-start gap-3 md:gap-4">
                    <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-full md:size-10", tone)}>
                      <Icon className="size-4 md:size-5" aria-hidden />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between">
                        <p className="text-xs md:text-sm">
                          <span className="font-medium">{item.name}</span>{" "}
                          <span className="text-muted-foreground">{item.action}</span>
                        </p>
                        <span className="mt-0.5 shrink-0 text-[11px] text-muted-foreground sm:mt-0 md:text-xs">
                          {item.time} ago
                        </span>
                      </div>
                      {item.snippet && (
                        <p className="mt-0.5 truncate text-xs text-muted-foreground md:text-sm">
                          &ldquo;{item.snippet}&rdquo;
                        </p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </div>

      {/* 4. Useful, but nobody needs it to run today. */}
      <div className="grid grid-cols-1 gap-4 md:gap-6 lg:grid-cols-3">
        <Panel title="Follow-ups today" action={{ href: "/dashboard/follow-ups", label: "Open" }}>
          <ul className="flex flex-col gap-3">
            <li className="flex items-center gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-primary">
                <MessageSquareText className="size-4" aria-hidden />
              </span>
              <p className="flex-1 text-xs md:text-sm">Feedback requests due today</p>
              <span className="font-heading text-lg font-bold">{d.followUpsDueToday.feedback}</span>
            </li>
            <li className="flex items-center gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-primary">
                <Megaphone className="size-4" aria-hidden />
              </span>
              <p className="flex-1 text-xs md:text-sm">Reorder reminders due today</p>
              <span className="font-heading text-lg font-bold">{d.followUpsDueToday.reorder}</span>
            </li>
            <li className="flex items-center gap-2 border-t pt-3 text-xs text-muted-foreground md:text-sm">
              <Star className="size-4 fill-[#E0A030] text-[#E0A030]" aria-hidden />
              {d.feedbackAverage !== null
                ? `${d.feedbackAverage.toFixed(1)} average rating from ${d.feedbackCount} review${d.feedbackCount === 1 ? "" : "s"}`
                : "No reviews yet"}
            </li>
          </ul>
        </Panel>

        <Panel title="Orders this week">
          {d.topOrdersThisWeek.length === 0 ? (
            <EmptyRow>No paid orders this week yet.</EmptyRow>
          ) : (
            <>
              <ul className="flex flex-col divide-y">
                {d.topOrdersThisWeek.map((o, i) => (
                  <li key={`${o.name}-${i}`} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-bold text-primary">
                      {i + 1}
                    </span>
                    <p className="min-w-0 flex-1 truncate text-xs font-medium md:text-sm">{o.name}</p>
                    <span className="text-xs font-semibold md:text-sm">{formatMoney(o.amount)}</span>
                  </li>
                ))}
              </ul>
              {d.avgOrderValueThisWeek !== null && (
                <p className="mt-3 border-t pt-3 text-xs text-muted-foreground md:text-sm">
                  Average order value this week: {formatMoney(Math.round(d.avgOrderValueThisWeek))}
                </p>
              )}
            </>
          )}
        </Panel>

        <div className="rounded-xl bg-primary p-5 text-primary-foreground shadow-sm md:p-6">
          <div className="mb-2 flex items-center gap-2 md:gap-3">
            <TrendingUp className="size-4 text-primary-foreground/80 md:size-5" aria-hidden />
            <h2 className="font-heading text-xs font-semibold uppercase tracking-wider text-primary-foreground/80 md:text-sm">
              Weekly growth
            </h2>
          </div>
          <p className="mb-1 font-heading text-3xl font-bold md:text-4xl">
            {formatChangePct(d.messagesGrowthPct) ?? "—"}
          </p>
          <p className="text-xs text-primary-foreground/80 md:text-sm">
            {d.messagesGrowthPct !== null
              ? "Change in incoming messages compared to last week."
              : "Not enough history yet to compare with last week."}
          </p>
        </div>
      </div>
    </div>
  );
}
