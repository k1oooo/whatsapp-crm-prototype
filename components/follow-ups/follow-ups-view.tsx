"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import {
  CalendarClock,
  Loader2,
  Megaphone,
  MessageSquareText,
  RefreshCw,
  Send,
  Settings2,
  Star,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { runFollowUpsNow, sendFollowUpNow, skipFollowUp } from "@/app/dashboard/follow-ups/actions";
import { AutomationsForm, BroadcastForm } from "@/components/follow-ups/follow-up-forms";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { FollowUpSettings } from "@/lib/follow-up-settings";
import type { FeedbackItem, QueueItem } from "@/lib/follow-up-types";
import { whenLabel } from "@/lib/leads";
import { cn } from "@/lib/utils";

const KIND: Record<string, { label: string; icon: LucideIcon }> = {
  feedback: { label: "Feedback request", icon: MessageSquareText },
  reorder: { label: "Reorder reminder", icon: RefreshCw },
  marketing: { label: "Promotion", icon: Megaphone },
};

const when = whenLabel;

function Stars({ rating }: { rating: number | null }) {
  return (
    <span className="flex gap-0.5" aria-label={rating ? `${rating} out of 5` : "No rating"}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          aria-hidden
          className={cn("size-4", rating && n <= rating ? "fill-[#E0A030] text-[#E0A030]" : "text-border")}
        />
      ))}
    </span>
  );
}

function StatusBadge({ item }: { item: QueueItem }) {
  if (item.status === "sent") return <Badge variant="success">Sent</Badge>;
  if (item.status === "skipped") return <Badge variant="muted">Skipped</Badge>;
  if (item.status === "failed") return <Badge variant="warning">Failed</Badge>;
  if (item.status === "sending") return <Badge variant="info">Sending</Badge>;
  const needsOk = item.kind !== "marketing" && item.lead?.follow_up_consent !== "yes";
  return needsOk ? <Badge variant="warning">Waiting for OK</Badge> : <Badge variant="info">Scheduled</Badge>;
}

function QueueRow({ item }: { item: QueueItem }) {
  const [pending, start] = useTransition();
  const meta = KIND[item.kind];
  const Icon = meta.icon;
  const name = item.lead?.name ?? `+${item.lead?.wa_contact_number ?? "unknown"}`;
  const open = item.status === "scheduled";
  const retryable = (item.status === "skipped" || item.status === "failed") && item.detail !== "The customer opted out";

  function act(fn: () => Promise<{ ok?: boolean; error?: string; notice?: string }>, done: string) {
    start(async () => {
      const res = await fn();
      if (res.error) toast.error(res.error);
      else toast.success(done, { description: res.notice });
    });
  }

  return (
    <li>
      <Card className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-secondary text-primary">
          <Icon className="size-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-x-2">
            {item.lead ? (
              <Link href={`/dashboard/leads/${item.lead.id}`} className="font-semibold hover:underline">
                {name}
              </Link>
            ) : (
              <span className="font-semibold">{name}</span>
            )}
            <span className="text-muted-foreground">{item.campaign ? `${meta.label}: ${item.campaign}` : meta.label}</span>
          </p>
          <p className="mt-0.5 flex items-center gap-1.5 text-sm text-muted-foreground">
            <CalendarClock className="size-4" aria-hidden />
            {item.status === "sent" && item.sent_at ? `Sent ${when(item.sent_at)}` : `Due ${when(item.due_at)}`}
          </p>
          {item.detail && <p className="mt-0.5 text-sm text-muted-foreground">{item.detail}</p>}
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge item={item} />
          {retryable && (
            <Button size="sm" variant="outline" disabled={pending} onClick={() => act(() => sendFollowUpNow(item.id), "Follow-up checked")}>
              {pending ? <Loader2 className="animate-spin" /> : <RefreshCw />}
              Try again
            </Button>
          )}
          {open && (
            <>
              <Button size="sm" variant="outline" disabled={pending} onClick={() => act(() => sendFollowUpNow(item.id), "Follow-up sent")}>
                {pending ? <Loader2 className="animate-spin" /> : <Send />}
                Send now
              </Button>
              <Button size="sm" variant="ghost" disabled={pending} onClick={() => act(() => skipFollowUp(item.id), "Skipped")}>
                Skip
              </Button>
            </>
          )}
        </div>
      </Card>
    </li>
  );
}

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <li className="rounded-xl border bg-card p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 font-heading text-3xl font-bold">{value}</p>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </li>
  );
}

export function FollowUpsView({
  queue,
  feedback,
  settings,
  audience,
  optedIn,
  testMode,
}: {
  queue: QueueItem[];
  feedback: FeedbackItem[];
  settings: FollowUpSettings;
  audience: number;
  optedIn: number;
  testMode: boolean;
}) {
  const [filter, setFilter] = useState<"upcoming" | "sent" | "closed">("upcoming");
  const [running, startRun] = useTransition();

  const upcoming = queue
    .filter((q) => q.status === "scheduled" || q.status === "sending")
    .sort((a, b) => a.due_at.localeCompare(b.due_at));
  const sent = queue.filter((q) => q.status === "sent").sort((a, b) => (b.sent_at ?? "").localeCompare(a.sent_at ?? ""));
  const closed = queue.filter((q) => q.status === "skipped" || q.status === "failed");
  const shown = filter === "upcoming" ? upcoming : filter === "sent" ? sent : closed;

  const rated = feedback.filter((f) => f.rating !== null);
  const average = rated.length ? rated.reduce((sum, f) => sum + (f.rating ?? 0), 0) / rated.length : null;

  function runNow() {
    startRun(async () => {
      const res = await runFollowUpsNow();
      if (res.error) toast.error(res.error);
      else toast.success("Follow-ups checked", { description: res.notice });
    });
  }

  const filters: { id: typeof filter; label: string; count: number }[] = [
    { id: "upcoming", label: "Upcoming", count: upcoming.length },
    { id: "sent", label: "Sent", count: sent.length },
    { id: "closed", label: "Skipped or failed", count: closed.length },
  ];

  return (
    <Tabs defaultValue="queue" className="gap-6">
      <TabsList className="w-full sm:w-fit">
        <TabsTrigger value="queue">
          <CalendarClock /> Queue
        </TabsTrigger>
        <TabsTrigger value="feedback">
          <Star /> Feedback
        </TabsTrigger>
        <TabsTrigger value="automations">
          <Settings2 /> Automations
        </TabsTrigger>
        <TabsTrigger value="broadcast">
          <Megaphone /> Promotion
        </TabsTrigger>
      </TabsList>

      <TabsContent value="queue" className="flex flex-col gap-5">
        <ul className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Tile label="Upcoming" value={String(upcoming.length)} />
          <Tile label="Sent" value={String(sent.length)} />
          <Tile label="Agreed to follow-ups" value={String(optedIn)} hint={optedIn === 1 ? "customer" : "customers"} />
          <Tile label="Average rating" value={average ? average.toFixed(1) : "None yet"} hint={rated.length ? `${rated.length} ratings` : undefined} />
        </ul>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2" role="group" aria-label="Filter">
            {filters.map((f) => (
              <Button
                key={f.id}
                size="sm"
                variant={filter === f.id ? "default" : "outline"}
                aria-pressed={filter === f.id}
                onClick={() => setFilter(f.id)}
              >
                {f.label} {f.count}
              </Button>
            ))}
          </div>
          <Button variant="outline" size="sm" onClick={runNow} disabled={running}>
            {running ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            Send what is due
          </Button>
        </div>

        {shown.length === 0 ? (
          <div className="rounded-xl border border-dashed p-8 text-center">
            <p className="font-semibold">Nothing here yet</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
              When you click Payment received on an order, its follow-ups appear here. Turn them on in Automations.
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {shown.map((item) => (
              <QueueRow key={item.id} item={item} />
            ))}
          </ul>
        )}
      </TabsContent>

      <TabsContent value="feedback" className="flex flex-col gap-5">
        {feedback.length === 0 ? (
          <div className="rounded-xl border border-dashed p-8 text-center">
            <p className="font-semibold">No feedback yet</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
              Ratings and comments appear here when customers answer your feedback request.
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {feedback.map((f) => {
              const name = f.lead?.name ?? `+${f.lead?.wa_contact_number ?? "unknown"}`;
              const low = f.rating !== null && f.rating <= 3;
              return (
                <li key={f.id}>
                  <Card className="flex flex-col gap-2 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-3">
                        <Stars rating={f.rating} />
                        {low && <Badge variant="warning">Needs a personal reply</Badge>}
                      </div>
                      <span className="text-sm text-muted-foreground">{when(f.created_at)}</span>
                    </div>
                    {f.comment && <p>{f.comment}</p>}
                    {f.lead && (
                      <Link href={`/dashboard/leads/${f.lead.id}`} className="w-fit text-sm font-medium text-primary hover:underline">
                        {name}
                      </Link>
                    )}
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </TabsContent>

      <TabsContent value="automations">
        <AutomationsForm settings={settings} testMode={testMode} />
      </TabsContent>

      <TabsContent value="broadcast">
        <BroadcastForm audience={audience} testMode={testMode} />
      </TabsContent>
    </Tabs>
  );
}
