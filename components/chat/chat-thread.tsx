"use client";

import { Fragment, useEffect, useRef } from "react";
import { Bot, Image as ImageIcon } from "lucide-react";
import { HandoffCard } from "@/components/chat/handoff-card";
import { clockTime, dayKey, dayLabel, isMedia, previewText } from "@/lib/leads";
import { cn } from "@/lib/utils";

export interface Msg {
  id: string;
  direction: "in" | "out";
  body: string | null;
  sent_at: string;
  source: string | null;
}

export interface Handoff {
  leadId: string;
  reason: string | null;
  title: string;
  note: string | null;
}

function Bubble({ m }: { m: Msg }) {
  const out = m.direction === "out";
  const bot = out && m.source === "bot";

  return (
    <li className={cn("flex", out && "justify-end")}>
      <div
        className={cn(
          "max-w-[85%] rounded-2xl px-3.5 py-2 shadow-xs sm:max-w-[75%]",
          out
            ? bot
              ? "rounded-br-sm border border-[#BFDCCB] bg-bubble-bot"
              : "rounded-br-sm bg-bubble-owner"
            : "rounded-bl-sm border bg-card",
        )}
      >
        {isMedia(m.body) ? (
          <p className="flex items-center gap-2 font-medium">
            <ImageIcon className="size-4" aria-hidden />
            {previewText(m.body)}
          </p>
        ) : (
          <p className="break-words whitespace-pre-wrap">{m.body}</p>
        )}
        <p className="mt-1 flex items-center justify-end gap-1 text-[11px] text-muted-foreground">
          {bot && <Bot className="size-3" aria-hidden />}
          {out ? (bot ? "Assistant, " : "You, ") : ""}
          {clockTime(m.sent_at)}
        </p>
      </div>
    </li>
  );
}

export function ChatThread({ messages, handoff }: { messages: Msg[]; handoff: Handoff | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const count = messages.length + (handoff ? 1 : 0);

  // Open at the newest message, and follow new ones unless the admin scrolled up to read.
  useEffect(() => {
    const el = ref.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [count]);

  function onScroll() {
    const el = ref.current;
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  }

  return (
    <div
      ref={ref}
      onScroll={onScroll}
      role="log"
      aria-label="Conversation"
      tabIndex={0}
      className="min-h-0 flex-1 overflow-y-auto bg-chat px-3 py-4 outline-none sm:px-6"
    >
      {messages.length === 0 && !handoff ? (
        <p className="py-10 text-center text-muted-foreground">No messages yet.</p>
      ) : (
        <ul className="mx-auto flex max-w-3xl flex-col gap-2">
          {messages.map((m, i) => {
            const newDay = i === 0 || dayKey(messages[i - 1].sent_at) !== dayKey(m.sent_at);
            return (
              <Fragment key={m.id}>
                {newDay && (
                  <li className="flex justify-center py-2">
                    <span className="rounded-full bg-card px-3 py-1 text-xs font-medium text-muted-foreground shadow-xs">
                      {dayLabel(m.sent_at)}
                    </span>
                  </li>
                )}
                <Bubble m={m} />
              </Fragment>
            );
          })}
          {handoff && <HandoffCard key={handoff.note ?? handoff.reason ?? "pending"} {...handoff} />}
        </ul>
      )}
    </div>
  );
}
