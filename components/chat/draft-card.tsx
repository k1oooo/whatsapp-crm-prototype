"use client";

import { useState, useTransition, type FormEvent } from "react";
import { Loader2, Send, Trash2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { discardDraftReply, sendDraftReply } from "@/app/dashboard/actions/replies";
import type { FormState } from "@/app/dashboard/actions/shared";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

// Sits inside the conversation, right where the assistant would have replied, so the owner sees
// exactly what the AI wants to say next to this exact customer before it goes out.
export function DraftCard({ leadId, body }: { leadId: string; body: string }) {
  const [pending, start] = useTransition();
  const [text, setText] = useState(body);

  function report(res: FormState, success: string) {
    if (res.error) toast.error(res.error);
    else toast.success(success, { description: res.notice });
  }

  function send(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    start(async () => {
      report(await sendDraftReply(leadId, {}, data), "Sent");
    });
  }

  function discard() {
    start(async () => {
      const res = await discardDraftReply(leadId);
      if (res.error) toast.error(res.error);
      else toast.success("Draft discarded");
    });
  }

  return (
    <li className="my-2">
      <div className="rounded-2xl border border-info-border bg-info p-4 text-info-foreground shadow-xs">
        <div className="flex items-start gap-3">
          <Sparkles className="mt-0.5 size-5 shrink-0" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="font-semibold">Draft reply ready</p>
            <p className="mt-0.5 text-sm">Nothing has been sent yet. Edit it, then send, or discard it.</p>
          </div>
        </div>

        <form onSubmit={send} className="mt-3 flex flex-col gap-2 sm:pl-8">
          <Textarea
            name="body"
            value={text}
            onChange={(e) => setText(e.target.value)}
            aria-label="Draft reply"
            rows={4}
            className="min-h-28 bg-white"
          />
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button type="submit" disabled={pending || !text.trim()} className="sm:w-fit">
              {pending ? <Loader2 className="animate-spin" /> : <Send />}
              Send
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={discard}
              disabled={pending}
              className="border-info-border bg-white text-info-foreground sm:w-fit"
            >
              <Trash2 />
              Discard
            </Button>
          </div>
        </form>
      </div>
    </li>
  );
}
