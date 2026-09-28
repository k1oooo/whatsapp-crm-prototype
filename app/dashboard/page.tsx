import {
  Activity,
  Banknote,
  CircleCheck,
  Hourglass,
  MessageSquareText,
  Plus,
  Send,
  TrendingUp,
  Users,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";

export default async function DashboardOverview() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("leads")
    .select("pending_decision, order_status, stage");
  const rows = data ?? [];

  const needsYou = rows.filter((r) => r.pending_decision).length;
  const waiting = rows.filter((r) => r.order_status === "confirmed").length;
  const paid = rows.filter((r) => r.order_status === "paid").length;

  const tiles = [
    {
      label: "Need you",
      value: needsYou,
      icon: Hourglass,
      tone: "bg-warning text-warning-foreground",
    },
    {
      label: "Waiting for payment",
      value: waiting,
      icon: Banknote,
      tone: "bg-info text-info-foreground",
    },
    {
      label: "Paid orders",
      value: paid,
      icon: CircleCheck,
      tone: "bg-success text-success-foreground",
    },
  ];

  // Hardcoded data for dashboard expansion
  const recentActivity = [
    {
      id: 1,
      name: "Faiz",
      action: "paid their order",
      extra: "RM 150.00",
      time: "2 hours ago",
      icon: Banknote,
      tone: "bg-success/10 text-success",
    },
    {
      id: 2,
      name: "Reyna",
      action: "confirmed order details",
      time: "4 hours ago",
      icon: CircleCheck,
      tone: "bg-primary/10 text-primary",
    },
    {
      id: 3,
      name: "Jett",
      action: "sent a new message",
      time: "5 hours ago",
      icon: MessageSquareText,
      tone: "bg-info/10 text-info",
    },
    {
      id: 4,
      name: "Unknown Number",
      action: "started a new chat",
      time: "Yesterday",
      icon: Users,
      tone: "bg-muted text-muted-foreground",
    },
  ];

  return (
    <div className="flex h-full flex-col gap-6 md:gap-8 bg-muted/20 p-4 md:p-6 lg:p-8 overflow-y-auto">
      {/* Header */}
      <div className="flex items-center gap-3 md:gap-4">
        <span className="flex size-10 md:size-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Activity className="size-5 md:size-6" aria-hidden />
        </span>
        <div>
          <h1 className="font-heading text-xl md:text-2xl font-bold">
            Overview
          </h1>
          <p className="text-sm md:text-base text-muted-foreground">
            A quick glance at your pipeline and orders.
          </p>
        </div>
      </div>

      {/* Primary Metrics */}
      <ul className="grid w-full grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {tiles.map(({ label, value, icon: Icon, tone }) => (
          <li
            key={label}
            className="flex flex-col justify-between rounded-xl border bg-card p-5 md:p-6 shadow-sm"
          >
            <div className="flex items-center gap-4">
              <span
                className={`flex size-10 md:size-12 shrink-0 items-center justify-center rounded-xl ${tone}`}
              >
                <Icon className="size-5 md:size-6" aria-hidden />
              </span>
              <div>
                <p className="text-xs md:text-sm font-medium text-muted-foreground">
                  {label}
                </p>
                <p className="font-heading text-2xl md:text-3xl font-bold">
                  {value}
                </p>
              </div>
            </div>
          </li>
        ))}
      </ul>

      {/* Secondary Section: Activity & Actions */}
      <div className="grid grid-cols-1 gap-4 md:gap-6 lg:grid-cols-3">
        {/* Recent Activity List */}
        <div className="col-span-1 lg:col-span-2 rounded-xl border bg-card p-5 md:p-6 shadow-sm">
          <h2 className="font-heading text-base md:text-lg font-bold mb-4 md:mb-6">
            Recent Activity
          </h2>
          <ul className="flex flex-col gap-4 md:gap-6">
            {recentActivity.map((item) => (
              <li key={item.id} className="flex items-start gap-3 md:gap-4">
                <span
                  className={`flex size-9 md:size-10 shrink-0 items-center justify-center rounded-full ${item.tone}`}
                >
                  <item.icon className="size-4 md:size-5" aria-hidden />
                </span>
                <div className="flex flex-1 flex-col sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-xs md:text-sm">
                      <span className="font-medium text-foreground">
                        {item.name}
                      </span>{" "}
                      <span className="text-muted-foreground">
                        {item.action}
                      </span>
                      {item.extra && (
                        <span className="font-medium text-foreground">
                          {" "}
                          • {item.extra}
                        </span>
                      )}
                    </p>
                  </div>
                  <span className="text-[11px] md:text-xs text-muted-foreground mt-1 sm:mt-0">
                    {item.time}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </div>

        {/* Quick Actions & Performance Panel */}
        <div className="col-span-1 flex flex-col gap-4 md:gap-6">
          <div className="rounded-xl border bg-card p-5 md:p-6 shadow-sm">
            <h2 className="font-heading text-base md:text-lg font-bold mb-4">
              Quick Actions
            </h2>
            <div className="flex flex-col gap-2 md:gap-3">
              <button className="flex w-full items-center gap-3 rounded-lg border bg-background p-3 text-xs md:text-sm font-medium transition-colors hover:bg-accent hover:text-foreground">
                <Plus className="size-4" />
                Add manual lead
              </button>
              <button className="flex w-full items-center gap-3 rounded-lg border bg-background p-3 text-xs md:text-sm font-medium transition-colors hover:bg-accent hover:text-foreground">
                <Send className="size-4" />
                Send broadcast
              </button>
            </div>
          </div>

          <div className="rounded-xl bg-primary p-5 md:p-6 text-primary-foreground shadow-sm">
            <div className="flex items-center gap-2 md:gap-3 mb-2">
              <TrendingUp className="size-4 md:size-5 text-primary-foreground/80" />
              <h2 className="font-heading text-xs md:text-sm font-semibold uppercase tracking-wider text-primary-foreground/80">
                Weekly Growth
              </h2>
            </div>
            <p className="font-heading text-3xl md:text-4xl font-bold mb-1">
              +24%
            </p>
            <p className="text-xs md:text-sm text-primary-foreground/80">
              Increase in incoming messages compared to last week.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
