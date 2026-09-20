"use client";

import { useState, useTransition, type FormEvent } from "react";
import { Check, Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { answerHandoff, clearPending, confirmPayment, type FormState } from "@/app/dashboard/actions";
import { ReasonIcon } from "@/components/reason-icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const PLACEHOLDER: Record<string, string> = {
  discount: "e.g. Yes, RM200 is fine",
  payment: "What should I tell them?",
  stock: "e.g. Yes, we can do it",
  approval: "e.g. Yes, we can do it",
};

// The approval sits inside the conversation, right where the assistant stopped.
export function HandoffCard({
  leadId,
  reason,
  title,
  note,
}: {
  leadId: string;
  reason: string | null;
  title: string;
  note: string | null;
}) {
  const [pending, start] = useTransition();
  const isPayment = reason === "payment";
  const [showText, setShowText] = useState(!isPayment);
  const [text, setText] = useState("");

  function report(res: FormState, success: string) {
    if (res.error) toast.error(res.error);
    else toast.success(success, { description: res.notice });
  }

  function confirm() {
    start(async () => {
      report(await confirmPayment(leadId, {}, new FormData()), "Payment confirmed. The customer has been told.");
    });
  }

  function send(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    start(async () => {
      const res = await answerHandoff(leadId, {}, data);
      report(res, "Answer sent");
      if (res.ok) setText("");
    });
  }

  function alreadyAnswered() {
    start(async () => {
      await clearPending(leadId);
      toast.success("Marked as answered");
    });
  }

  return (
    <li className="my-2">
      <div className="rounded-2xl border border-warning-border bg-warning p-4 text-warning-foreground shadow-xs">
        <div className="flex items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-white/70">
            <ReasonIcon reason={reason} className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold">Needs you: {title}</p>
            {note && <p className="mt-0.5">{note}</p>}
          </div>
        </div>

        <div className="mt-3 flex flex-col gap-3 sm:pl-12">
          {isPayment && (
            <Button onClick={confirm} disabled={pending} size="lg" className="w-full sm:w-fit">
              {pending ? <Loader2 className="animate-spin" /> : <Check />}
              Payment received
            </Button>
          )}

          {showText ? (
            <form onSubmit={send} className="flex flex-col gap-2 sm:flex-row">
              <Input
                name="note"
                required
                value={text}
                onChange={(e) => setText(e.target.value)}
                aria-label="Your answer"
                placeholder={PLACEHOLDER[reason ?? ""] ?? "e.g. Yes, we can do it"}
                className="bg-white sm:flex-1"
              />
              <Button type="submit" disabled={pending}>
                {pending ? <Loader2 className="animate-spin" /> : <Send />}
                Send
              </Button>
            </form>
          ) : (
            <Button variant="link" onClick={() => setShowText(true)} className="h-auto w-fit p-0 text-warning-foreground">
              Payment not there? Write a reply instead
            </Button>
          )}
          {showText && (
            <p className="text-sm">The assistant words it in the customer&apos;s language and sends it.</p>
          )}

          <Button
            variant="link"
            onClick={alreadyAnswered}
            disabled={pending}
            className="h-auto w-fit p-0 text-sm font-medium text-warning-foreground"
          >
            I already answered on WhatsApp
          </Button>
        </div>
      </div>
    </li>
  );
}
