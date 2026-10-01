import * as React from "react";
import { cn } from "@/lib/utils";

// A native checkbox, sized and coloured to match the rest of the controls. Native keeps form
// submission, keyboard and screen reader behavior for free.
function Checkbox({ className, ...props }: Omit<React.ComponentProps<"input">, "type">) {
  return (
    <input
      type="checkbox"
      data-slot="checkbox"
      className={cn(
        "size-5 shrink-0 cursor-pointer rounded-md border border-control accent-primary outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-60",
        className,
      )}
      {...props}
    />
  );
}

export { Checkbox };
