import * as React from "react";
import { cn } from "@/lib/utils";

// One choice in a group of radio options, drawn as a card. Native radio underneath, so the
// group works with the keyboard (arrow keys) and submits with the form.
function RadioCard({
  title,
  description,
  className,
  ...props
}: Omit<React.ComponentProps<"input">, "type" | "title"> & {
  title: string;
  description?: string;
}) {
  return (
    <label
      className={cn(
        "flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-control p-3 transition-colors has-[:checked]:border-primary has-[:checked]:bg-secondary has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/40",
        className,
      )}
    >
      <input type="radio" className="mt-1 size-4 shrink-0 accent-primary" {...props} />
      <span>
        <span className="block font-medium">{title}</span>
        {description && <span className="block text-sm text-muted-foreground">{description}</span>}
      </span>
    </label>
  );
}

export { RadioCard };
