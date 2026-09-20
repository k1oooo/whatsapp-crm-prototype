"use client";

import { useActionState } from "react";
import { saveSettings, type FormState } from "@/app/dashboard/actions";

const box =
  "mt-1 w-full rounded-lg border border-[#D8E0DA] bg-white px-3 py-2 text-base focus-visible:outline-2 focus-visible:outline-[#1F7A5C]";

export function SettingsForm({
  autoReply,
  facts,
  toneNotes,
  paymentDetails,
}: {
  autoReply: boolean;
  facts: string;
  toneNotes: string;
  paymentDetails: string;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveSettings, {});

  return (
    <form action={action} className="space-y-6">
      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          name="auto_reply"
          defaultChecked={autoReply}
          className="mt-1 size-5 accent-[#1F7A5C]"
        />
        <span>
          <span className="block font-semibold">Answer customers automatically</span>
          <span className="block text-[#55645E]">
            The assistant replies on its own. It hands the chat to you for discounts, stock or
            availability, payments, and anything it is not sure about.
          </span>
        </span>
      </label>

      <label className="block text-sm font-medium">
        What the assistant may say
        <span className="mt-1 block font-normal text-[#55645E]">
          Menu and prices, delivery areas and fees, minimum order, lead time, opening hours,
          address, how to pay. It only uses what you write here and hands over anything else.
        </span>
        <textarea
          name="business_facts"
          defaultValue={facts}
          rows={14}
          placeholder={
            "Products and prices:\n- Cupcake (chocolate, vanilla, red velvet) RM3 each, minimum order 12\n- Birthday cake 2 tier RM220, serves 20\n\nPickup: Wangsa Maju, 9am to 6pm, Mon to Sat\nDelivery: Shah Alam and PJ, RM10\nLead time: order at least 1 day before for cupcakes, 3 days for cakes\nPayment: bank transfer, details are sent after the customer confirms the order"
          }
          className={box}
        />
      </label>

      <label className="block text-sm font-medium">
        Payment details
        <span className="mt-1 block font-normal text-[#55645E]">
          Sent word for word to a customer right after they confirm an order. Keep them out of the
          box above.
        </span>
        <textarea
          name="payment_details"
          defaultValue={paymentDetails}
          rows={4}
          placeholder={"Bank transfer to:\nMaybank 1234 5678 9012\nAccount name: Test Bakery"}
          className={box}
        />
      </label>

      <label className="block text-sm font-medium">
        How you talk to customers (optional)
        <input
          name="tone_notes"
          defaultValue={toneNotes}
          placeholder="Friendly and short, Manglish is fine, a little emoji"
          className={box}
        />
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-full border border-[#1F7A5C] bg-[#1F7A5C] px-4 py-2 text-sm font-medium text-white disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1F7A5C]"
        >
          {pending ? "Saving..." : "Save settings"}
        </button>
        {state.ok && !pending && <p className="text-sm text-[#1F7A5C]">Saved</p>}
        {state.error && (
          <p role="alert" className="text-sm text-[#B26A00]">
            {state.error}
          </p>
        )}
      </div>
    </form>
  );
}
