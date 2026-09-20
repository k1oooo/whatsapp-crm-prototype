"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Columns3, MessagesSquare, Settings, type LucideIcon } from "lucide-react";
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
    { href: "/dashboard/settings", label: "Settings", icon: Settings, active: (p) => p.startsWith("/dashboard/settings") },
  ];
}

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
            aria-label={collapsed ? (count ? `${label}, ${count} need you` : label) : undefined}
            aria-current={on ? "page" : undefined}
            className={cn(
              "relative flex h-11 items-center gap-3 rounded-lg text-[15px] font-medium text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40",
              collapsed ? "justify-center" : "px-3",
              on && "bg-secondary text-foreground",
            )}
          >
            <Icon className={cn("size-5", on && "text-primary")} />
            {!collapsed && label}
            {!!count &&
              (collapsed ? (
                <span className="absolute top-1 right-1 flex min-w-4 items-center justify-center rounded-full bg-[#B26A00] px-1 text-[10px] leading-4 font-bold text-white">
                  {count}
                </span>
              ) : (
                <Badge variant="warning" className="ml-auto" aria-label={`${count} need you`}>
                  {count}
                </Badge>
              ))}
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
      className="grid shrink-0 grid-cols-3 border-t bg-card pb-[env(safe-area-inset-bottom)] lg:hidden"
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
