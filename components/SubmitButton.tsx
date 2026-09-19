"use client";

import { useFormStatus } from "react-dom";

export function SubmitButton({
  children,
  pendingText,
  variant = "quiet",
}: {
  children: React.ReactNode;
  pendingText: string;
  variant?: "primary" | "quiet";
}) {
  const { pending } = useFormStatus();
  const style =
    variant === "primary"
      ? "bg-[#1F7A5C] text-white border-[#1F7A5C]"
      : "bg-white border-[#D8E0DA] hover:border-[#1F7A5C]";

  return (
    <button
      type="submit"
      disabled={pending}
      className={`rounded-full border px-4 py-2 text-sm font-medium disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1F7A5C] ${style}`}
    >
      {pending ? pendingText : children}
    </button>
  );
}
