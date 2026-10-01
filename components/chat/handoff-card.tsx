"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import { Check, Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { answerHandoff, clearPending, confirmPayment, type FormState } from "@/app/dashboard/actions";
import { ReasonIcon } from "@/components/reason-icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { rm } from "@/lib/leads";

// After the owner taps "Payment received" the customer is messaged, so there is a short window
// to take it back before anything is sent.
const UNDO_SECONDS = 6;

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
  amount,
  question,
}: {
  leadId: string;
  reason: string | null;
  title: string;
  note: string | null;
  amount: number | null;
  /** The customer's latest message, offered as the question when saving the answer for next time. */
  question: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const isPayment = reason === "payment";
  const [showText, setShowText] = useState(!isPayment);
  const [text, setText] = useState("");

  function report(res: FormState, success: string) {
    if (res.error) toast.error(res.error);
    else toast.success(success, { description: res.notice });
  }

  // null = idle, otherwise the seconds left before the confirmation goes out.
  const [countdown, setCountdown] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const sentRef = useRef(false);

  function sendConfirmation() {
    if (sentRef.current) return;
    sentRef.current = true;
    setCountdown(null);
    start(async () => {
      report(await confirmPayment(leadId, {}, new FormData()), "Payment confirmed. The customer has been told.");
      sentRef.current = false;
    });
  }

  function stopTimer() {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  }

  function confirm() {
    setCountdown(UNDO_SECONDS);
    stopTimer();
    timer.current = setInterval(() => {
      setCountdown((n) => (n === null ? null : n - 1));
    }, 1000);
  }

  function undo() {
    stopTimer();
    setCountdown(null);
  }

  // When the timer reaches zero, send. If the owner leaves the page mid-countdown they had
  // already chosen to confirm, so it still goes out rather than being silently dropped.
  useEffect(() => {
    if (countdown !== null && countdown <= 0) {
      stopTimer();
      sendConfirmation();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countdown]);

  const countdownRef = useRef<number | null>(null);
  useEffect(() => {
    countdownRef.current = countdown;
  }, [countdown]);
  useEffect(
    () => () => {
      stopTimer();
      if (countdownRef.current !== null && countdownRef.current > 0) {
        void confirmPayment(leadId, {}, new FormData());
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  function send(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    start(async () => {
      const answer = String(data.get("note") ?? "").trim();
      const res = await answerHandoff(leadId, {}, data);
      // When the assistant did not know something, teach it, so it does not ask again.
      const teachable = reason === "unsure" || reason === "stock";
      if (res.ok && teachable) {
        toast.success("Answer sent", {
          description: res.notice,
          action: {
            label: "Save to Knowledge base",
            onClick: () =>
              router.push(
                `/dashboard/knowledge?q=${encodeURIComponent(question ?? "")}&a=${encodeURIComponent(answer)}`,
              ),
          },
          duration: 10000,
        });
      } else {
        report(res, "Answer sent");
      }
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
            countdown === null ? (
              <Button onClick={confirm} disabled={pending} size="lg" className="w-full sm:w-fit">
                {pending ? <Loader2 className="animate-spin" /> : <Check />}
                {amount ? `Payment received, ${rm(amount)}` : "Payment received"}
              </Button>
            ) : (
              <div
                role="status"
                className="flex flex-wrap items-center gap-3 rounded-xl bg-white/70 px-4 py-3"
              >
                <p className="font-medium">Telling the customer in {countdown}s</p>
                <Button variant="outline" onClick={undo} className="bg-white">
                  Undo
                </Button>
              </div>
            )
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
            <Button variant="link" onClick={() => setShowText(true)} className="h-11 w-fit p-0 text-warning-foreground">
              Payment not there? Write a reply instead
            </Button>
          )}
          {showText && (
            <p className="text-sm">The assistant words it in the customer&apos;s language and sends it.</p>
          )}

          <Button
            variant="outline"
            onClick={alreadyAnswered}
            disabled={pending || countdown !== null}
            className="w-full border-warning-border bg-white/60 text-warning-foreground hover:bg-white sm:w-fit"
          >
            I already answered on WhatsApp
          </Button>
        </div>
      </div>
    </li>
  );
}
