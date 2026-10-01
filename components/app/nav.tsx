"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  BookOpen,
  Columns3,
  CreditCard,
  Ellipsis,
  LayoutDashboard,
  LogOut,
  Megaphone,
  MessagesSquare,
  Settings,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
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
          label: "Overview",
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
              "flex h-6 items-center px-3 text-xs font-semibold tracking-wider text-muted-foreground uppercase transition-opacity duration-200",
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
                aria-label={count ? `${label}, ${count} need${count === 1 ? "s" : ""} you` : label}
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
                        "absolute top-0.5 right-0.5 flex min-w-5 items-center justify-center rounded-full bg-alert px-1 text-xs leading-5 font-bold text-alert-foreground transition-opacity duration-200",
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

// Phones: the three places used all day sit in the bar, everything else is under More.
// Hidden inside a chat, which has its own Back button and needs the room for typing.
export function MobileNav({ needsYou }: { needsYou: number }) {
  const pathname = usePathname();
  const groups = useNavGroups(needsYou);
  const [moreOpen, setMoreOpen] = useState(false);

  const all = groups.flatMap((g) => g.items);
  const find = (href: string) => all.find((i) => i.href === href)!;
  const tabs = ["/dashboard/inbox", "/dashboard/pipeline", "/dashboard/follow-ups"].map(find);
  const more = [find("/dashboard"), find("/dashboard/knowledge"), find("/dashboard/settings"), find("/dashboard/billing")];
  const moreActive = more.some((i) => i.active(pathname));

  if (pathname.startsWith("/dashboard/leads/")) return null;

  const tabClass =
    "relative flex h-16 flex-col items-center justify-center gap-1 text-xs font-medium text-muted-foreground outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/40";

  return (
    <nav
      aria-label="Main"
      className="grid shrink-0 grid-cols-4 border-t bg-card pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      {tabs.map(({ href, label, short, icon: Icon, active, count }) => {
        const on = active(pathname);
        return (
          <Link
            key={href}
            href={href}
            aria-current={on ? "page" : undefined}
            aria-label={count ? `${label}, ${count} need${count === 1 ? "s" : ""} you` : label}
            className={cn(tabClass, on && "bg-primary/5 text-primary")}
          >
            <span className="relative">
              <Icon className="size-5" aria-hidden />
              {!!count && (
                <span
                  aria-hidden
                  className="absolute -top-1.5 -right-3 flex min-w-5 items-center justify-center rounded-full bg-alert px-1 text-xs leading-5 font-bold text-alert-foreground shadow-sm"
                >
                  {count}
                </span>
              )}
            </span>
            <span aria-hidden>{short ?? label}</span>
          </Link>
        );
      })}

      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetTrigger className={cn(tabClass, moreActive && "bg-primary/5 text-primary")}>
          <Ellipsis className="size-5" aria-hidden />
          <span>More</span>
        </SheetTrigger>
        <SheetContent side="bottom">
          <SheetHeader>
            <SheetTitle className="font-heading">More</SheetTitle>
            <SheetDescription className="sr-only">Other pages and sign out</SheetDescription>
          </SheetHeader>
          <div className="flex flex-col gap-2">
            {more.map(({ href, label, icon: Icon, active }) => {
              const on = active(pathname);
              return (
                <Link
                  key={href}
                  href={href}
                  onClick={() => setMoreOpen(false)}
                  aria-current={on ? "page" : undefined}
                  className={cn(
                    "flex min-h-14 w-full items-center gap-4 rounded-2xl p-4 text-[15px] font-medium outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/40",
                    on ? "bg-primary/10 text-primary" : "bg-muted/40 text-foreground hover:bg-muted",
                  )}
                >
                  <Icon className={cn("size-5", on ? "text-primary" : "text-muted-foreground")} aria-hidden />
                  {label}
                </Link>
              );
            })}
          </div>
          <form action={signOut} className="mt-2 border-t pt-4">
            <button
              type="submit"
              className="flex min-h-14 w-full items-center gap-4 rounded-2xl p-4 text-[15px] font-medium text-muted-foreground outline-none transition-colors hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/40"
            >
              <LogOut className="size-5" aria-hidden />
              Sign out
            </button>
          </form>
        </SheetContent>
      </Sheet>
    </nav>
  );
}
