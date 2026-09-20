"use client";

import { useActionState, useState } from "react";
import {
  answerHandoff,
  clearPending,
  confirmPayment,
  type FormState,
} from "@/app/dashboard/actions";

const PLACEHOLDER: Record<string, string> = {
  discount: "Your answer, e.g. Yes, RM200 is fine",
  payment: "What should I tell them?",
  stock: "Your answer, e.g. Yes, we can do it",
  approval: "Your answer, e.g. Yes, we can do it",
};

// The approval sits inside the conversation, right where the assistant stopped.
export function InlineHandoff({
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
  const [payState, payAction, payPending] = useActionState<FormState, FormData>(
    confirmPayment.bind(null, leadId),
    {},
  );
  const [answerState, answerAction, answerPending] = useActionState<FormState, FormData>(
    answerHandoff.bind(null, leadId),
    {},
  );

  const isPayment = reason === "payment";
  const [showText, setShowText] = useState(!isPayment);
  const error = payState.error ?? answerState.error;
  const notice = payState.notice ?? answerState.notice;

  return (
    <li>
      <div className="rounded-xl border border-[#EBCB94] bg-[#FBEBD0] p-4 text-[#5C3600]">
        <p className="font-semibold">Needs you: {title}</p>
        {note && <p className="mt-1">{note}</p>}

        {isPayment && (
          <form action={payAction} className="mt-3">
            <button
              type="submit"
              disabled={payPending}
              className="rounded-full bg-[#1F7A5C] px-5 py-2 text-sm font-semibold text-white disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1F7A5C]"
            >
              {payPending ? "Confirming..." : "Payment received"}
            </button>
          </form>
        )}

        {showText ? (
          <form action={answerAction} className="mt-3 flex flex-wrap items-center gap-2">
            <input
              name="note"
              required
              aria-label="Your answer"
              placeholder={PLACEHOLDER[reason ?? ""] ?? "Your answer, e.g. Yes, we can do it"}
              className="min-w-0 flex-1 rounded-lg border border-[#D8C08F] bg-white px-3 py-2 text-base text-[#12251F] focus-visible:outline-2 focus-visible:outline-[#1F7A5C]"
            />
            <button
              type="submit"
              disabled={answerPending}
              className="rounded-full border border-[#1F7A5C] bg-[#1F7A5C] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1F7A5C]"
            >
              {answerPending ? "Sending..." : "Send"}
            </button>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setShowText(true)}
            className="mt-3 block text-sm underline focus-visible:outline-2 focus-visible:outline-[#1F7A5C]"
          >
            Payment not there? Write a reply instead
          </button>
        )}
        {showText && (
          <p className="mt-1 text-sm">The assistant words it in the customer&apos;s language and sends it.</p>
        )}

        <form action={clearPending.bind(null, leadId)} className="mt-2">
          <button
            type="submit"
            className="text-sm underline focus-visible:outline-2 focus-visible:outline-[#1F7A5C]"
          >
            I already answered on WhatsApp
          </button>
        </form>

        {error && (
          <p role="alert" className="mt-2 text-sm font-medium text-[#8A2D00]">
            {error}
          </p>
        )}
        {notice && <p className="mt-2 text-sm">{notice}</p>}
      </div>
    </li>
  );
}
