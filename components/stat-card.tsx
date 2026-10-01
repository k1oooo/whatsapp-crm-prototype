import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

// A number with a label. Optionally an icon tile and a link, when the number leads somewhere.
export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone,
  href,
  className,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  icon?: LucideIcon;
  tone?: string;
  href?: string;
  className?: string;
}) {
  const body = (
    <>
      {Icon && (
        <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-xl md:size-12", tone ?? "bg-secondary text-primary")}>
          <Icon className="size-5 md:size-6" aria-hidden />
        </span>
      )}
      <div className="min-w-0">
        <p className="text-xs font-medium text-muted-foreground md:text-sm">{label}</p>
        <p className="font-heading text-2xl font-bold md:text-3xl">{value}</p>
        {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
      </div>
    </>
  );
  const base = "flex items-center gap-4 rounded-xl border bg-card p-4 shadow-sm md:p-5";
  return href ? (
    <Link href={href} className={cn(base, "transition-colors outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/40", className)}>
      {body}
    </Link>
  ) : (
    <div className={cn(base, className)}>{body}</div>
  );
}
