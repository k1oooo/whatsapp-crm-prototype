"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  BookOpen,
  Briefcase,
  Columns3,
  CreditCard,
  LayoutDashboard,
  LogOut,
  Megaphone,
  MessagesSquare,
  Settings,
  SlidersHorizontal,
  X,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { signOut } from "@/app/login/actions";
import { cn } from "@/lib/utils";

interface NavItem {
  href: string;
  label: string;
  short?: string;
  icon: LucideIcon;
  active: (path: string) => boolean;
  count?: number;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

function useNavGroups(needsYou: number): NavGroup[] {
  return [
    {
      label: "Workspace",
      items: [
        {
          href: "/dashboard",
          label: "Dashboard",
          icon: LayoutDashboard,
          active: (p) => p === "/dashboard",
        },
        {
          href: "/dashboard/inbox",
          label: "Inbox",
          icon: MessagesSquare,
          active: (p) =>
            p.startsWith("/dashboard/inbox") ||
            p.startsWith("/dashboard/leads"),
          count: needsYou,
        },
        {
          href: "/dashboard/pipeline",
          label: "Pipeline",
          icon: Columns3,
          active: (p) => p.startsWith("/dashboard/pipeline"),
        },
        {
          href: "/dashboard/follow-ups",
          label: "Follow-ups",
          icon: Megaphone,
          active: (p) => p.startsWith("/dashboard/follow-ups"),
        },
      ],
    },
    {
      label: "Management",
      items: [
        {
          href: "/dashboard/knowledge",
          label: "Knowledge base",
          short: "Knowledge",
          icon: BookOpen,
          active: (p) => p.startsWith("/dashboard/knowledge"),
        },
        {
          href: "/dashboard/settings",
          label: "AI Settings",
          short: "AI",
          icon: Settings,
          active: (p) => p.startsWith("/dashboard/settings"),
        },
        {
          href: "/dashboard/billing",
          label: "Billing",
          icon: CreditCard,
          active: (p) => p.startsWith("/dashboard/billing"),
        },
      ],
    },
  ];
}

export function SidebarNav({
  needsYou,
  collapsed = false,
}: {
  needsYou: number;
  collapsed?: boolean;
}) {
  const pathname = usePathname();
  const groups = useNavGroups(needsYou);

  return (
    <nav aria-label="Main" className="flex flex-col gap-5 lg:gap-6">
      {groups.map((group) => (
        <div key={group.label} className="flex flex-col gap-1">
          <div
            aria-hidden
            className={cn(
              "flex h-6 items-center px-3 text-[10px] lg:text-[11px] font-semibold tracking-wider text-muted-foreground/60 uppercase transition-opacity duration-200",
              collapsed ? "opacity-0" : "opacity-100 delay-100",
            )}
          >
            <span className="truncate">{group.label}</span>
          </div>

          {group.items.map(({ href, label, icon: Icon, active, count }) => {
            const on = active(pathname);
            return (
              <Link
                key={href}
                href={href}
                title={collapsed ? label : undefined}
                aria-label={count ? `${label}, ${count} need you` : label}
                aria-current={on ? "page" : undefined}
                className={cn(
                  "relative flex h-10 lg:h-11 w-full items-center overflow-hidden rounded-lg text-sm lg:text-[15px] font-medium whitespace-nowrap text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40",
                  on && "bg-secondary text-foreground",
                )}
              >
                <span className="relative flex size-10 lg:size-11 shrink-0 items-center justify-center">
                  <Icon
                    className={cn("size-4 lg:size-5", on && "text-primary")}
                  />
                  {!!count && (
                    <span
                      aria-hidden
                      className={cn(
                        "absolute top-1 lg:top-1.5 right-1 lg:right-1.5 flex min-w-4 items-center justify-center rounded-full bg-[#B26A00] px-1 text-[9px] lg:text-[10px] leading-4 font-bold text-white transition-opacity duration-200",
                        collapsed ? "opacity-100 delay-100" : "opacity-0",
                      )}
                    >
                      {count}
                    </span>
                  )}
                </span>
                <span
                  aria-hidden
                  className={cn(
                    "transition-opacity duration-200",
                    collapsed ? "opacity-0" : "opacity-100 delay-100",
                  )}
                >
                  {label}
                </span>
                {!!count && (
                  <span className="pointer-events-none absolute inset-y-0 left-0 flex w-full items-center justify-end pr-3">
                    <Badge
                      variant="warning"
                      aria-hidden
                      className={cn(
                        "transition-opacity duration-200",
                        collapsed ? "opacity-0" : "opacity-100 delay-100",
                      )}
                    >
                      {count}
                    </Badge>
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

export function MobileNav({ needsYou }: { needsYou: number }) {
  const pathname = usePathname();
  const groups = useNavGroups(needsYou);
  const [openGroup, setOpenGroup] = useState<string | null>(null);

  // Accumulate total notifications for the Workspace tab
  const workspaceCount =
    groups
      .find((g) => g.label === "Workspace")
      ?.items.reduce((acc, item) => acc + (item.count || 0), 0) || 0;

  return (
    <>
      {/* Mobile Drawer Overlay */}
      {openGroup && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end md:hidden">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-background/80 backdrop-blur-sm transition-opacity"
            onClick={() => setOpenGroup(null)}
          />

          {/* Slide-up panel */}
          <div className="relative z-50 w-full animate-in slide-in-from-bottom-4 rounded-t-3xl border-t bg-card px-4 pb-8 pt-6 shadow-[0_-8px_30px_rgba(0,0,0,0.12)]">
            <div className="mb-6 flex items-center justify-between px-2">
              <h2 className="font-heading text-xl font-bold">{openGroup}</h2>
              <button
                onClick={() => setOpenGroup(null)}
                className="rounded-full p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <X className="size-5" />
              </button>
            </div>

            <div className="flex flex-col gap-2">
              {groups
                .find((g) => g.label === openGroup)
                ?.items.map(({ href, label, icon: Icon, active, count }) => {
                  const on = active(pathname);
                  return (
                    <Link
                      key={href}
                      href={href}
                      onClick={() => setOpenGroup(null)}
                      className={cn(
                        "flex w-full items-center gap-4 rounded-2xl p-4 text-[15px] font-medium transition-colors",
                        on
                          ? "bg-primary/10 text-primary"
                          : "bg-muted/40 text-foreground hover:bg-muted",
                      )}
                    >
                      <Icon
                        className={cn(
                          "size-5",
                          on ? "text-primary" : "text-muted-foreground",
                        )}
                      />
                      <span className="flex-1">{label}</span>
                      {!!count && (
                        <span className="flex min-w-5 items-center justify-center rounded-full bg-[#B26A00] px-2 py-0.5 text-[11px] font-bold text-white shadow-sm">
                          {count}
                        </span>
                      )}
                    </Link>
                  );
                })}
            </div>
          </div>
        </div>
      )}

      {/* 3-Tab Bottom Navigation */}
      <nav
        aria-label="Main"
        className="grid shrink-0 grid-cols-3 border-t bg-card pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        <button
          onClick={() =>
            setOpenGroup(openGroup === "Workspace" ? null : "Workspace")
          }
          className={cn(
            "relative flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium text-muted-foreground outline-none transition-colors",
            openGroup === "Workspace" && "bg-primary/5 text-primary",
          )}
        >
          <span className="relative">
            <Briefcase className="size-5" />
            {workspaceCount > 0 && (
              <span className="absolute -right-2.5 -top-1.5 flex min-w-4 items-center justify-center rounded-full bg-[#B26A00] px-1 text-[9px] font-bold leading-4 text-white shadow-sm">
                {workspaceCount}
              </span>
            )}
          </span>
          <span>Workspace</span>
        </button>

        <button
          onClick={() =>
            setOpenGroup(openGroup === "Management" ? null : "Management")
          }
          className={cn(
            "relative flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium text-muted-foreground outline-none transition-colors",
            openGroup === "Management" && "bg-primary/5 text-primary",
          )}
        >
          <SlidersHorizontal className="size-5" />
          <span>Management</span>
        </button>

        <form action={signOut} className="flex h-full w-full flex-col">
          <button
            type="submit"
            className="flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium text-muted-foreground outline-none transition-colors hover:bg-muted/50 hover:text-foreground"
          >
            <LogOut className="size-5" />
            <span>Sign out</span>
          </button>
        </form>
      </nav>
    </>
  );
}
