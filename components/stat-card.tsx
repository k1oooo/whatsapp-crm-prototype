import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

// A number with a label. Optionally an icon tile and a link, when the number leads somewhere.
export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  href,
  className,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  icon?: LucideIcon;
  href?: string;
  className?: string;
}) {
  const body = (
    <>
      {Icon && (
        <Icon className="size-5 shrink-0 text-primary md:size-6" aria-hidden />
      )}
      <div className="min-w-0">
        <p className="text-xs font-medium text-muted-foreground md:text-sm">
          {label}
        </p>
        <p className="font-heading text-2xl font-bold md:text-3xl">{value}</p>
        {hint && (
          <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>
        )}
      </div>
    </>
  );
  // h-full: fill the grid cell, so cards in one row are the same height. Without an icon the text is
  // top-aligned, so labels and numbers line up even when one card has an extra hint line.
  const base = cn(
    "flex h-full gap-4 rounded-xl border bg-card p-4 shadow-sm md:p-5",
    Icon ? "items-center" : "items-start",
  );
  return href ? (
    <Link
      href={href}
      className={cn(
        base,
        "transition-colors outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/40",
        className,
      )}
    >
      {body}
    </Link>
  ) : (
    <div className={cn(base, className)}>{body}</div>
  );
}
