"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpen, Columns3, Megaphone, MessagesSquare, Settings, type LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface Item {
  href: string;
  label: string;
  icon: LucideIcon;
  active: (path: string) => boolean;
  count?: number;
}

function useItems(needsYou: number): Item[] {
  return [
    {
      href: "/dashboard",
      label: "Inbox",
      icon: MessagesSquare,
      active: (p) => p === "/dashboard" || p.startsWith("/dashboard/leads"),
      count: needsYou,
    },
    { href: "/dashboard/pipeline", label: "Pipeline", icon: Columns3, active: (p) => p.startsWith("/dashboard/pipeline") },
    { href: "/dashboard/follow-ups", label: "Follow-ups", icon: Megaphone, active: (p) => p.startsWith("/dashboard/follow-ups") },
    { href: "/dashboard/knowledge", label: "Knowledge base", icon: BookOpen, active: (p) => p.startsWith("/dashboard/knowledge") },
    { href: "/dashboard/settings", label: "Settings", icon: Settings, active: (p) => p.startsWith("/dashboard/settings") },
  ];
}

// Every item has the same layout open or closed. The icon stays put and the sidebar's width
// simply reveals or hides the text, so nothing jumps.
export function SidebarNav({ needsYou, collapsed = false }: { needsYou: number; collapsed?: boolean }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="flex flex-col gap-1">
      {useItems(needsYou).map(({ href, label, icon: Icon, active, count }) => {
        const on = active(pathname);
        return (
          <Link
            key={href}
            href={href}
            title={collapsed ? label : undefined}
            aria-label={count ? `${label}, ${count} need you` : label}
            aria-current={on ? "page" : undefined}
            className={cn(
              "relative flex h-11 w-full items-center overflow-hidden rounded-lg text-[15px] font-medium whitespace-nowrap text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40",
              on && "bg-secondary text-foreground",
            )}
          >
            <span className="relative flex size-11 shrink-0 items-center justify-center">
              <Icon className={cn("size-5", on && "text-primary")} />
              {!!count && (
                <span
                  aria-hidden
                  className={cn(
                    "absolute top-1 right-1 flex min-w-4 items-center justify-center rounded-full bg-[#B26A00] px-1 text-[10px] leading-4 font-bold text-white transition-opacity duration-200",
                    collapsed ? "opacity-100 delay-100" : "opacity-0",
                  )}
                >
                  {count}
                </span>
              )}
            </span>
            <span
              aria-hidden
              className={cn("transition-opacity duration-200", collapsed ? "opacity-0" : "opacity-100 delay-100")}
            >
              {label}
            </span>
            {!!count && (
              <span className="pointer-events-none absolute inset-y-0 left-0 flex w-[236px] items-center justify-end pr-3">
                <Badge
                  variant="warning"
                  aria-hidden
                  className={cn("transition-opacity duration-200", collapsed ? "opacity-0" : "opacity-100 delay-100")}
                >
                  {count}
                </Badge>
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

export function MobileNav({ needsYou }: { needsYou: number }) {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Main"
      className="grid shrink-0 grid-cols-5 border-t bg-card pb-[env(safe-area-inset-bottom)] lg:hidden"
    >
      {useItems(needsYou).map(({ href, label, icon: Icon, active, count }) => {
        const on = active(pathname);
        return (
          <Link
            key={href}
            href={href}
            aria-current={on ? "page" : undefined}
            className={cn(
              "relative flex h-14 flex-col items-center justify-center gap-0.5 text-xs font-medium text-muted-foreground outline-none focus-visible:bg-accent",
              on && "text-primary",
            )}
          >
            <span className="relative">
              <Icon className="size-5" />
              {!!count && (
                <span className="absolute -top-1.5 -right-2.5 flex min-w-4 items-center justify-center rounded-full bg-[#B26A00] px-1 text-[10px] leading-4 font-bold text-white">
                  {count}
                </span>
              )}
            </span>
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
