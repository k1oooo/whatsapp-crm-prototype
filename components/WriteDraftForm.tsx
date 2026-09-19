"use client";

import { useActionState } from "react";
import { createDraft, type FormState } from "@/app/dashboard/actions";

export function WriteDraftForm({
  leadId,
  label,
  primary = false,
}: {
  leadId: string;
  label: string;
  primary?: boolean;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(
    createDraft.bind(null, leadId),
    {},
  );

  const style = primary
    ? "bg-[#1F7A5C] text-white border-[#1F7A5C]"
    : "bg-white border-[#D8E0DA] hover:border-[#1F7A5C]";

  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      <button
        type="submit"
        disabled={pending}
        className={`rounded-full border px-4 py-2 text-sm font-medium disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1F7A5C] ${style}`}
      >
        {pending ? "Writing..." : label}
      </button>
      {state.error && (
        <p role="alert" className="max-w-prose text-sm text-[#B26A00]">
          {state.error}
        </p>
      )}
    </form>
  );
}
