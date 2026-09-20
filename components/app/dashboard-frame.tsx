"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ChatList } from "@/components/inbox/chat-list";
import type { ChatSummary } from "@/lib/leads";
import { cn } from "@/lib/utils";

// Inbox pages get a chat list on the left. Other pages (Pipeline, Settings) use the full width.
export function DashboardFrame({ chats, children }: { chats: ChatSummary[]; children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  // New WhatsApp messages arrive on their own, so quietly refresh while the tab is open.
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, 15000);
    return () => clearInterval(id);
  }, [router]);

  const onChat = pathname.startsWith("/dashboard/leads/");
  const inInbox = pathname === "/dashboard" || onChat;

  if (!inInbox) return <div className="h-full min-h-0 overflow-y-auto">{children}</div>;

  const activeId = onChat ? (pathname.split("/")[3] ?? null) : null;

  return (
    <div className="grid h-full min-h-0 lg:grid-cols-[22rem_minmax(0,1fr)]">
      <aside className={cn("min-h-0 border-r bg-card", onChat ? "hidden lg:block" : "block")}>
        <ChatList chats={chats} activeId={activeId} />
      </aside>
      <section className={cn("min-h-0 min-w-0", onChat ? "block" : "hidden lg:block")}>{children}</section>
    </div>
  );
}
