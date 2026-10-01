import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

// The "nothing here yet" box. Says what is missing and what to do next.
export function EmptyState({
  icon: Icon,
  title,
  children,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("w-full rounded-xl border border-dashed p-6 text-center sm:p-8", className)}>
      {Icon && <Icon className="mx-auto mb-2 size-8 text-muted-foreground" aria-hidden />}
      <p className="font-semibold">{title}</p>
      {children && <div className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{children}</div>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}
