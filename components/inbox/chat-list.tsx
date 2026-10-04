"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Bot, Image as ImageIcon, MessageSquareDashed, Search, X } from "lucide-react";
import { searchMessages } from "@/app/dashboard/actions/messages";
import { ChatAvatar } from "@/components/chat-avatar";
import { EmptyState } from "@/components/empty-state";
import { ChatFilterSheet } from "@/components/inbox/chat-filter-sheet";
import { ALL_FILTERS, matchesFilters, type FilterId } from "@/components/inbox/chat-filters";
import { LeadStatusBadge } from "@/components/lead-status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { chatTime, isMedia, previewText, type ChatSummary } from "@/lib/leads";
import { cn } from "@/lib/utils";

function Preview({ chat }: { chat: ChatSummary }) {
  if (!chat.lastBody) return <span className="text-muted-foreground">No messages yet</span>;
  const who = chat.lastDirection === "out" ? (chat.lastSource === "bot" ? "Assistant: " : "You: ") : "";
  return (
    <span className="flex min-w-0 items-center gap-1 text-muted-foreground">
      {chat.lastSource === "bot" && chat.lastDirection === "out" && <Bot className="size-3.5 shrink-0" aria-hidden />}
      {isMedia(chat.lastBody) && <ImageIcon className="size-3.5 shrink-0" aria-hidden />}
      <span className="truncate">
        {who && chat.lastSource !== "bot" ? who : ""}
        {previewText(chat.lastBody)}
      </span>
    </span>
  );
}

function Item({ chat, active }: { chat: ChatSummary; active: boolean }) {
  return (
    <li>
      <Link
        href={`/dashboard/leads/${chat.id}`}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex gap-3 border-b px-4 py-3 outline-none transition-colors hover:bg-accent focus-visible:bg-accent",
          active && "bg-secondary hover:bg-secondary",
        )}
      >
        <ChatAvatar name={chat.name} alert={chat.needsYou} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <p className="truncate font-semibold">{chat.name}</p>
            {chat.lastAt && (
              <time dateTime={chat.lastAt} className="shrink-0 text-xs text-muted-foreground">
                {chatTime(chat.lastAt)}
              </time>
            )}
          </div>
          <div className="mt-0.5 text-sm">
            <Preview chat={chat} />
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
            <LeadStatusBadge {...chat} />
            {chat.needsYou && chat.waiting && (
              <span className="text-xs font-medium text-warning-foreground">Waiting {chat.waiting}</span>
            )}
          </div>
        </div>
      </Link>
    </li>
  );
}

const NO_HITS: Set<string> = new Set();

export function ChatList({ chats, activeId }: { chats: ChatSummary[]; activeId: string | null }) {
  const needsCount = chats.filter((c) => c.needsYou).length;
  const [filters, setFilters] = useState<Set<FilterId>>(() => (needsCount > 0 ? new Set(["needs_you"]) : new Set()));
  const [query, setQuery] = useState("");
  const [messageHits, setMessageHits] = useState<Set<string>>(new Set());

  const q = query.trim().toLowerCase();

  // Also look inside the messages themselves ("Hari Raya", an item name), after a short pause.
  useEffect(() => {
    if (q.length < 2) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      const ids = await searchMessages(q);
      if (!cancelled) setMessageHits(new Set(ids));
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q]);

  // Hits only count while the search is long enough to have been run.
  const hits = q.length >= 2 ? messageHits : NO_HITS;

  const shown = useMemo(
    () =>
      chats.filter(
        (c) =>
          matchesFilters(c, filters) &&
          (!q ||
            c.name.toLowerCase().includes(q) ||
            c.number.includes(q.replace(/^\+/, "")) ||
            hits.has(c.id)),
      ),
    [chats, filters, q, hits],
  );

  const activeChips = ALL_FILTERS.filter((f) => filters.has(f.id));

  function removeFilter(id: FilterId) {
    const next = new Set(filters);
    next.delete(id);
    setFilters(next);
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="space-y-3 border-b p-4">
        <div className="flex items-center justify-between gap-2">
          <h1 className="font-heading text-2xl leading-tight font-bold">Inbox</h1>
          {needsCount > 0 && <Badge variant="warning">{needsCount} need you</Badge>}
        </div>

        <div className="flex gap-2">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name, number or message"
              aria-label="Search chats"
              className="pl-9"
            />
          </div>
          <ChatFilterSheet selected={filters} onChange={setFilters} />
        </div>

        {activeChips.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            {activeChips.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => removeFilter(f.id)}
                aria-label={`Remove filter: ${f.label}`}
                className="flex h-9 items-center gap-1 rounded-full border border-control bg-secondary pr-2.5 pl-3.5 text-sm font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
              >
                {f.label}
                <X className="size-4" aria-hidden />
              </button>
            ))}
            <Button variant="link" size="sm" className="px-2" onClick={() => setFilters(new Set())}>
              Clear all
            </Button>
          </div>
        )}
      </div>

      {shown.length === 0 ? (
        <div className="flex flex-1 items-center p-6">
          {q || activeChips.length > 0 ? (
            <EmptyState icon={MessageSquareDashed} title="No chats match">
              Try a different search or fewer filters.
            </EmptyState>
          ) : (
            <EmptyState icon={MessageSquareDashed} title="No chats yet">
              New WhatsApp messages will show up here.
            </EmptyState>
          )}
        </div>
      ) : (
        <ul className="min-h-0 flex-1 overflow-y-auto">
          {shown.map((chat) => (
            <Item key={chat.id} chat={chat} active={chat.id === activeId} />
          ))}
        </ul>
      )}
    </div>
  );
}
