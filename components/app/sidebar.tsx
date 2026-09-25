"use client";

import Link from "next/link";
import { useState } from "react";
import { MessagesSquare, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { AssistantToggle } from "@/components/app/assistant-toggle";
import { SidebarNav } from "@/components/app/nav";
import { SignOutButton } from "@/components/app/sign-out-button";
import { Button } from "@/components/ui/button";
import { signOut } from "@/app/login/actions";
import { cn } from "@/lib/utils";

const fade = (collapsed: boolean) =>
  cn(
    "transition-opacity duration-200",
    collapsed ? "opacity-0" : "opacity-100 delay-100",
  );

// Open and closed use the exact same layout. Only the sidebar's width changes, which reveals or
// hides the text. Icons and the logo never move, so nothing twitches.
export function Sidebar({
  businessName,
  autoReply,
  needsYou,
  defaultCollapsed,
}: {
  businessName: string;
  autoReply: boolean;
  needsYou: number;
  defaultCollapsed: boolean;
}) {
  // The choice is kept in a cookie, so the server draws the sidebar the way you left it.
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  function toggle() {
    const next = !collapsed;
    setCollapsed(next);
    document.cookie = `sidebar-collapsed=${next ? 1 : 0}; path=/; max-age=31536000; samesite=lax`;
  }

  return (
    <aside
      className={cn(
        "hidden shrink-0 overflow-clip border-r bg-card transition-[width] duration-300 ease-in-out motion-reduce:transition-none lg:block",
        collapsed ? "w-16" : "w-64",
      )}
    >
      <div className="flex h-full flex-col gap-6 p-2.5">
        <div className="relative h-11 shrink-0 overflow-hidden">
          <Link
            href="/dashboard"
            onClick={(e) => {
              // Closed, the logo is the "open the sidebar" button.
              if (collapsed) {
                e.preventDefault();
                toggle();
              }
            }}
            title={collapsed ? "Expand sidebar" : "Go to the inbox"}
            aria-label={
              collapsed ? "Expand sidebar" : `${businessName}, go to the inbox`
            }
            className="group/logo flex h-11 w-full items-center overflow-hidden rounded-xl whitespace-nowrap outline-none"
          >
            <span className="flex size-11 shrink-0 items-center justify-center">
              <span
                className={cn(
                  "relative flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground transition-colors duration-200 group-focus-visible/logo:ring-2 group-focus-visible/logo:ring-ring/50",
                  collapsed &&
                    "group-hover/logo:bg-secondary group-hover/logo:text-foreground",
                )}
              >
                <MessagesSquare
                  className={cn(
                    "absolute size-5 transition-opacity duration-200",
                    collapsed &&
                      "group-hover/logo:opacity-0 group-focus-visible/logo:opacity-0",
                  )}
                  aria-hidden
                />
                <PanelLeftOpen
                  className={cn(
                    "absolute size-5 opacity-0 transition-opacity duration-200",
                    collapsed &&
                      "group-hover/logo:opacity-100 group-focus-visible/logo:opacity-100",
                  )}
                  aria-hidden
                />
              </span>
            </span>
            <span aria-hidden className={cn("min-w-0 pl-2", fade(collapsed))}>
              <span className="block truncate font-heading text-lg leading-tight font-bold">
                {businessName}
              </span>
              <span className="block text-xs text-muted-foreground">
                WhatsApp orders
              </span>
            </span>
          </Link>

          <div className="pointer-events-none absolute inset-y-0 left-0 flex w-[236px] items-center justify-end">
            <Button
              variant="ghost"
              size="icon"
              onClick={toggle}
              inert={collapsed}
              aria-label="Collapse sidebar"
              title="Collapse sidebar"
              className={cn(
                "pointer-events-auto size-9 text-muted-foreground",
                fade(collapsed),
              )}
            >
              <PanelLeftClose />
            </Button>
          </div>
        </div>

        <SidebarNav needsYou={needsYou} collapsed={collapsed} />

        <div className="mt-auto flex flex-col gap-2">
          <AssistantToggle initial={autoReply} collapsed={collapsed} />
          <form action={signOut}>
            <SignOutButton collapsed={collapsed} />
          </form>
        </div>
      </div>
    </aside>
  );
}
