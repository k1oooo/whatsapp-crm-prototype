import { cn } from "@/lib/utils";
import { initials } from "@/lib/leads";

export function ChatAvatar({
  name,
  alert = false,
  className,
}: {
  name: string;
  alert?: boolean;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-11 shrink-0 items-center justify-center rounded-full bg-secondary font-heading text-sm font-bold text-primary",
        alert && "bg-warning text-warning-foreground ring-2 ring-warning-border",
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}
