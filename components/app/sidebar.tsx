"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import {
  LogOut,
  MessagesSquare,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";

import { SidebarNav } from "@/components/app/nav";
import { SubmitButton } from "@/components/SubmitButton";
import { Button } from "@/components/ui/button";
import { signOut } from "@/app/login/actions";
import { cn } from "@/lib/utils";

const KEY = "sidebar-collapsed";
const EVENT = "sidebar-toggle";

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(EVENT, onChange);
  };
}

function readCollapsed() {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function Sidebar({
  businessName,
  autoReply,
  needsYou,
}: {
  businessName: string;
  autoReply: boolean;
  needsYou: number;
}) {
  const collapsed = useSyncExternalStore(subscribe, readCollapsed, () => false);

  function toggle() {
    try {
      localStorage.setItem(KEY, collapsed ? "0" : "1");
    } catch {
      // Private mode
    }
    window.dispatchEvent(new Event(EVENT));
  }

  return (
    <aside
      className={cn(
        // Locked horizontal padding (px-3 = 12px).
        // 12px padding + 40px icon + 12px padding = 64px total width when collapsed.
        // This guarantees perfect centering when closed, and zero icon movement when expanding.
        "hidden shrink-0 flex-col gap-6 border-r bg-card transition-[width] duration-300 ease-in-out lg:flex overflow-hidden whitespace-nowrap",
        collapsed ? "w-16 py-4 px-3" : "w-64 py-4 px-3",
      )}
    >
      {/* Header Container */}
      <div className="flex items-center h-10 w-full">
        {/* Stationary Icon Container (Exactly 40x40px) */}
        <div className="relative size-10 shrink-0">
          <button
            type="button"
            onClick={toggle}
            className={cn(
              "absolute inset-0 flex items-center justify-center rounded-xl bg-primary text-primary-foreground transition-opacity duration-200 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40 group",
              collapsed
                ? "opacity-100 z-10 delay-100"
                : "opacity-0 z-0 pointer-events-none",
            )}
          >
            <MessagesSquare className="size-5 group-hover:hidden" aria-hidden />
            <PanelLeftOpen
              className="hidden size-5 group-hover:block"
              aria-hidden
            />
          </button>

          <Link
            href="/dashboard"
            className={cn(
              "absolute inset-0 flex items-center justify-center rounded-xl bg-primary text-primary-foreground transition-opacity duration-200 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40",
              collapsed
                ? "opacity-0 z-0 pointer-events-none"
                : "opacity-100 z-10 delay-100",
            )}
          >
            <MessagesSquare className="size-5" aria-hidden />
          </Link>
        </div>

        {/* CSS Grid text reveal: smoothly animates from 0px to its exact inner width */}
        <div
          className={cn(
            "grid transition-all duration-300 ease-in-out",
            collapsed
              ? "grid-cols-[0fr] opacity-0 ml-0"
              : "grid-cols-[1fr] opacity-100 ml-3",
          )}
        >
          <div className="overflow-hidden flex flex-col justify-center">
            <span className="block truncate font-heading text-lg font-bold leading-tight">
              {businessName}
            </span>
            <span className="block truncate text-xs text-muted-foreground">
              WhatsApp orders
            </span>
          </div>
        </div>

        {/* Close Button scales away gracefully */}
        <Button
          variant="ghost"
          size="icon"
          onClick={toggle}
          className={cn(
            "shrink-0 text-muted-foreground transition-all duration-300 ease-in-out ml-auto",
            collapsed
              ? "w-0 opacity-0 pointer-events-none overflow-hidden"
              : "w-9 opacity-100",
          )}
        >
          <PanelLeftClose />
        </Button>
      </div>

      <SidebarNav needsYou={needsYou} collapsed={collapsed} />

      <div className="mt-auto flex flex-col gap-3">
        <form
          action={signOut}
          className="flex w-full"
          title={collapsed ? "Sign out" : undefined}
        >
          <SubmitButton
            variant="ghost"
            pendingText="Signing out..."
            // Remove the default button padding (p-0) and handle alignment with our exact 40px icon box.
            // This ensures it lines up pixel-perfectly with the header logo above it.
            className="flex h-10 w-full items-center justify-start p-0 overflow-hidden"
          >
            {/* Same 40x40 stationary wrapper as the header */}
            <div className="flex size-10 shrink-0 items-center justify-center text-muted-foreground">
              <LogOut className="size-5" aria-hidden="true" />
            </div>

            {/* Same grid text reveal as the header */}
            <div
              className={cn(
                "grid transition-all duration-300 ease-in-out",
                collapsed
                  ? "grid-cols-[0fr] opacity-0 ml-0"
                  : "grid-cols-[1fr] opacity-100 ml-2",
              )}
            >
              <span className="overflow-hidden text-left text-muted-foreground">
                Sign out
              </span>
            </div>
          </SubmitButton>
        </form>
      </div>
    </aside>
  );
}
