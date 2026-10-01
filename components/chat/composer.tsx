"use client";

import { useState, useTransition, type FormEvent, type KeyboardEvent } from "react";
import { ExternalLink, Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { sendOwnerMessage } from "@/app/dashboard/actions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { waLink } from "@/lib/leads";

// Lets the owner write to a customer from the web app, without the assistant in between.
export function ChatComposer({ leadId, number }: { leadId: string; number: string }) {
  const [pending, start] = useTransition();
  const [text, setText] = useState("");

  function send(e?: FormEvent<HTMLFormElement>) {
    e?.preventDefault();
    const body = text.trim();
    if (!body || pending) return;
    const data = new FormData();
    data.set("body", body);
    start(async () => {
      const res = await sendOwnerMessage(leadId, {}, data);
      if (res.error) toast.error(res.error);
      else {
        setText("");
        toast.success("Sent", { description: res.notice });
      }
    });
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      send();
    }
  }

  return (
    <form onSubmit={send} className="border-t bg-card px-3 py-3 sm:px-5">
      <div className="mx-auto flex max-w-3xl items-end gap-2">
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          aria-label="Write to this customer"
          placeholder="Write to this customer"
          rows={1}
          className="max-h-40 min-h-11 flex-1 [field-sizing:content] resize-none"
        />
        <Button type="submit" size="icon" disabled={pending || !text.trim()} aria-label="Send message">
          {pending ? <Loader2 className="animate-spin" /> : <Send />}
        </Button>
      </div>
      <p className="mx-auto mt-2 flex max-w-3xl flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>Goes out from your business number, exactly as typed. Ctrl+Enter sends.</span>
        <a
          href={waLink(number, "")}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 font-medium text-primary underline-offset-2 hover:underline"
        >
          Open in WhatsApp
          <ExternalLink className="size-3" aria-hidden />
        </a>
      </p>
    </form>
  );
}
