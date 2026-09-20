"use client";

import Link from "next/link";
import { useState } from "react";
import { Bot, CircleCheck, Image as ImageIcon, MessageSquareDashed, Search } from "lucide-react";
import { ChatAvatar } from "@/components/chat-avatar";
import { ReasonIcon } from "@/components/reason-icon";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
            {chat.needsYou ? (
              <Badge variant="warning">
                <ReasonIcon reason={chat.reason} />
                {chat.reason ? (REASON_LABEL[chat.reason] ?? chat.reason) : "you said you would check"}
              </Badge>
            ) : chat.orderStatus === "paid" ? (
              <Badge variant="success">
                <CircleCheck />
                {ORDER_LABEL.paid}
              </Badge>
            ) : (
              <Badge variant="muted">
                <span aria-hidden className="size-1.5 rounded-full" style={{ background: STAGE_DOT[chat.stage] }} />
                {chat.orderStatus === "confirmed" ? "Waiting for payment" : STAGE_LABEL[chat.stage]}
              </Badge>
            )}
          </div>
        </div>
      </Link>
    </li>
  );
}

export function ChatList({ chats, activeId }: { chats: ChatSummary[]; activeId: string | null }) {
  const needs = chats.filter((c) => c.needsYou);
  const [tab, setTab] = useState<"needs" | "all">(needs.length > 0 ? "needs" : "all");
  const [query, setQuery] = useState("");

  const q = query.trim().toLowerCase();
  const pool = q ? chats : tab === "needs" ? needs : chats;
  const shown = pool.filter((c) => !q || c.name.toLowerCase().includes(q) || c.number.includes(q.replace(/^\+/, "")));

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="space-y-3 border-b p-4">
        <h1 className="font-heading text-2xl leading-tight font-bold">Inbox</h1>
        <div className="relative">
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
        <Tabs value={tab} onValueChange={(v) => setTab(v as "needs" | "all")}>
          <TabsList>
            <TabsTrigger value="needs">
              Needs you
              {needs.length > 0 && <Badge variant="warning">{needs.length}</Badge>}
            </TabsTrigger>
            <TabsTrigger value="all">All chats</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {shown.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
          {q ? (
            <>
              <MessageSquareDashed className="size-9 text-muted-foreground" aria-hidden />
              <p className="font-semibold">No chats match</p>
              <p className="text-sm text-muted-foreground">Try a different name or number.</p>
            </>
          ) : tab === "needs" ? (
            <>
              <CircleCheck className="size-9 text-primary" aria-hidden />
              <p className="font-semibold">Nothing needs you</p>
              <p className="text-sm text-muted-foreground">The assistant is handling every chat.</p>
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
