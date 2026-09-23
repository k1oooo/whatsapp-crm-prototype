"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Bot, CircleCheck, Image as ImageIcon, MessageSquareDashed, Search, X } from "lucide-react";
import { ChatAvatar } from "@/components/chat-avatar";
import { ChatFilterSheet } from "@/components/inbox/chat-filter-sheet";
import { ALL_FILTERS, matchesFilters, type FilterId } from "@/components/inbox/chat-filters";
import { ReasonIcon } from "@/components/reason-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ORDER_LABEL,
  REASON_LABEL,
  STAGE_DOT,
  STAGE_LABEL,
  chatTime,
  isMedia,
  previewText,
  type ChatSummary,
} from "@/lib/leads";
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

function StatusBadge({ chat }: { chat: ChatSummary }) {
  if (chat.needsYou) {
    return (
      <Badge variant="warning">
        <ReasonIcon reason={chat.reason} />
        {chat.reason ? (REASON_LABEL[chat.reason] ?? chat.reason) : "you said you would check"}
      </Badge>
    );
  }
  if (chat.orderStatus === "paid") {
    return (
      <Badge variant="success">
        <CircleCheck />
        {ORDER_LABEL.paid}
      </Badge>
    );
  }
  if (chat.orderStatus === "confirmed") return <Badge variant="info">Waiting for payment</Badge>;
  if (chat.cold) return <Badge variant="info">Quiet</Badge>;
  return (
    <Badge variant="muted">
      <span aria-hidden className="size-1.5 rounded-full" style={{ background: STAGE_DOT[chat.stage] }} />
      {STAGE_LABEL[chat.stage]}
    </Badge>
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
            <time className="shrink-0 text-xs text-muted-foreground">{chatTime(chat.lastAt)}</time>
          </div>
          <div className="mt-0.5 text-sm">
            <Preview chat={chat} />
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <StatusBadge chat={chat} />
          </div>
        </div>
      </Link>
    </li>
  );
}

export function ChatList({ chats, activeId }: { chats: ChatSummary[]; activeId: string | null }) {
  const needsCount = chats.filter((c) => c.needsYou).length;
  const [filters, setFilters] = useState<Set<FilterId>>(() => (needsCount > 0 ? new Set(["needs_you"]) : new Set()));
  const [query, setQuery] = useState("");

  const q = query.trim().toLowerCase();
  const shown = useMemo(
    () =>
      chats.filter(
        (c) =>
          matchesFilters(c, filters) &&
          (!q || c.name.toLowerCase().includes(q) || c.number.includes(q.replace(/^\+/, ""))),
      ),
    [chats, filters, q],
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
              placeholder="Search name or number"
              aria-label="Search chats"
              className="pl-9"
            />
          </div>
          <ChatFilterSheet selected={filters} onChange={setFilters} />
        </div>

        {activeChips.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {activeChips.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => removeFilter(f.id)}
                className="flex items-center gap-1 rounded-full border bg-secondary py-1 pr-2 pl-3 text-xs font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
              >
                {f.label}
                <X className="size-3.5" aria-hidden />
              </button>
            ))}
            <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => setFilters(new Set())}>
              Clear all
            </Button>
          </div>
        )}
      </div>

      {shown.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
          {q || activeChips.length > 0 ? (
            <>
              <MessageSquareDashed className="size-9 text-muted-foreground" aria-hidden />
              <p className="font-semibold">No chats match</p>
              <p className="text-sm text-muted-foreground">Try a different search or fewer filters.</p>
            </>
          ) : (
            <>
              <MessageSquareDashed className="size-9 text-muted-foreground" aria-hidden />
              <p className="font-semibold">No chats yet</p>
              <p className="text-sm text-muted-foreground">New WhatsApp messages will show up here.</p>
            </>
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
