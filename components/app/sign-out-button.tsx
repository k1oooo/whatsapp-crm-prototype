"use client";

import { Loader2, LogOut } from "lucide-react";
import { useFormStatus } from "react-dom";
import { cn } from "@/lib/utils";

export function SignOutButton({ collapsed }: { collapsed: boolean }) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      aria-label="Sign out"
      title={collapsed ? "Sign out" : undefined}
      className="flex h-11 w-full items-center overflow-hidden rounded-lg text-[15px] font-medium whitespace-nowrap text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:opacity-60"
    >
      <span className="flex size-11 shrink-0 items-center justify-center">
        {pending ? <Loader2 className="size-5 animate-spin" /> : <LogOut className="size-5" />}
      </span>
      <span
        aria-hidden
        className={cn("transition-opacity duration-200", collapsed ? "opacity-0" : "opacity-100 delay-100")}
      >
        {pending ? "Signing out..." : "Sign out"}
      </span>
    </button>
  );
}
