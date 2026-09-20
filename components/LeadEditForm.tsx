"use client";

import { useActionState } from "react";
import { updateLead, type FormState } from "@/app/dashboard/actions";
import type { Lead } from "@/lib/leads";

const input =
  "mt-1 w-full rounded-lg border border-[#D8E0DA] bg-white px-3 py-1.5 text-base focus-visible:outline-2 focus-visible:outline-[#1F7A5C]";

export function LeadEditForm({ lead }: { lead: Lead }) {
  const [state, action, pending] = useActionState<FormState, FormData>(
    updateLead.bind(null, lead.id),
    {},
  );

  return (
    <form action={action} className="space-y-3">
      <label className="block text-sm font-medium">
        Customer name
        <input name="name" defaultValue={lead.name ?? ""} className={input} />
      </label>
      <label className="block text-sm font-medium">
        What they want
        <input name="need" defaultValue={lead.need ?? ""} className={input} />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block text-sm font-medium">
          Their budget (RM)
          <input
            name="budget_myr"
            inputMode="numeric"
            defaultValue={lead.budget_myr ?? ""}
            className={input}
          />
        </label>
        <label className="block text-sm font-medium">
          You quoted (RM)
          <input
            name="quoted_price_myr"
            inputMode="numeric"
            defaultValue={lead.quoted_price_myr ?? ""}
            className={input}
          />
        </label>
      </div>
      <label className="block text-sm font-medium">
        Needed by
        <input name="deadline" type="date" defaultValue={lead.deadline ?? ""} className={input} />
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-full border border-[#1F7A5C] bg-[#1F7A5C] px-4 py-2 text-sm font-medium text-white disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1F7A5C]"
        >
          {pending ? "Saving..." : "Save changes"}
        </button>
        {state.ok && !pending && <p className="text-sm text-[#1F7A5C]">Saved</p>}
        {state.error && (
          <p role="alert" className="text-sm text-[#B26A00]">
            {state.error}
          </p>
        )}
      </div>
      <p className="text-sm text-[#55645E]">
        Anything you change here stays as you set it. The AI will not overwrite it.
      </p>
    </form>
  );
}
