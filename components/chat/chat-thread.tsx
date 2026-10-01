"use client";

import { Fragment, useEffect, useRef, useState, useTransition } from "react";
import { Bot, Image as ImageIcon, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { loadEarlierMessages } from "@/app/dashboard/actions";
import { HandoffCard } from "@/components/chat/handoff-card";
import { DraftCard } from "@/components/chat/draft-card";
import { Button } from "@/components/ui/button";
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
  /** The quoted price in RM, shown on the payment button. */
  amount: number | null;
}

export interface Draft {
  leadId: string;
  body: string;
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
              ? "rounded-br-sm border border-bubble-bot-border bg-bubble-bot"
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
        <p className="mt-1 flex items-center justify-end gap-1 text-xs text-muted-foreground">
          {bot && <Bot className="size-3" aria-hidden />}
          {out ? (bot ? "Assistant, " : "You, ") : ""}
          <time dateTime={m.sent_at}>{clockTime(m.sent_at)}</time>
        </p>
      </div>
    </li>
  );
}

// A short fingerprint of the draft text. When the assistant writes a new draft, the card starts
// over with the new text instead of keeping whatever the old draft's textarea held.
function fingerprint(text: string): string {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0;
  return `${text.length}-${h}`;
}

export function ChatThread({
  leadId,
  messages,
  hasEarlier,
  handoff,
  draft,
}: {
  leadId: string;
  messages: Msg[];
  hasEarlier: boolean;
  handoff: Handoff | null;
  draft: Draft | null;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const [earlier, setEarlier] = useState<Msg[]>([]);
  const [moreBefore, setMoreBefore] = useState(hasEarlier);
  const [loading, startLoad] = useTransition();

  // Older messages the owner asked for, kept apart from the live list, which refreshes itself.
  const liveIds = new Set(messages.map((m) => m.id));
  const all = [...earlier.filter((m) => !liveIds.has(m.id)), ...messages];
  const count = all.length + (handoff ? 1 : 0) + (draft ? 1 : 0);
  const lastQuestion =
    [...all].reverse().find((m) => m.direction === "in" && m.body && !isMedia(m.body))?.body ?? null;

  // Open at the newest message, and follow new ones unless the admin scrolled up to read.
  useEffect(() => {
    const el = ref.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [count]);

  function onScroll() {
    const el = ref.current;
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  }

  function loadMore() {
    if (all.length === 0) return;
    const oldest = all[0].sent_at;
    const el = ref.current;
    const before = el ? el.scrollHeight - el.scrollTop : 0;
    stick.current = false;
    startLoad(async () => {
      const res = await loadEarlierMessages(leadId, oldest);
      if (res.error) {
        toast.error(res.error);
        return;
      }
      setEarlier((prev) => {
        const seen = new Set([...prev, ...messages].map((m) => m.id));
        return [...res.messages.filter((m) => !seen.has(m.id)), ...prev];
      });
      setMoreBefore(res.hasMore);
      // Keep the message the owner was reading where it was.
      requestAnimationFrame(() => {
        if (el) el.scrollTop = el.scrollHeight - before;
      });
    });
  }

  return (
    <div
      ref={ref}
      onScroll={onScroll}
      role="log"
      aria-label="Conversation"
      tabIndex={0}
      className="min-h-0 flex-1 overflow-y-auto bg-chat px-3 py-4 outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/40 sm:px-6"
    >
      {all.length === 0 && !handoff && !draft ? (
        <p className="py-10 text-center text-muted-foreground">No messages yet.</p>
      ) : (
        <ul className="mx-auto flex max-w-3xl flex-col gap-2">
          {moreBefore && (
            <li className="flex justify-center pb-2">
              <Button variant="outline" size="sm" onClick={loadMore} disabled={loading}>
                {loading && <Loader2 className="animate-spin" />}
                Load earlier messages
              </Button>
            </li>
          )}
          {all.map((m, i) => {
            const newDay = i === 0 || dayKey(all[i - 1].sent_at) !== dayKey(m.sent_at);
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
          {handoff && (
            <HandoffCard
              key={handoff.note ?? handoff.reason ?? "pending"}
              {...handoff}
              question={lastQuestion}
            />
          )}
          {draft && <DraftCard key={`${draft.leadId}-${fingerprint(draft.body)}`} leadId={draft.leadId} body={draft.body} />}
        </ul>
      )}
    </div>
  );
}
