"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ChatList } from "@/components/inbox/chat-list";
import type { ChatSummary } from "@/lib/leads";
import { cn } from "@/lib/utils";

export function DashboardFrame({
  chats,
  children,
}: {
  chats: ChatSummary[];
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, 15000);
    return () => clearInterval(id);
  }, [router]);

  const onChat = pathname.startsWith("/dashboard/leads/");
  const inInbox = pathname.startsWith("/dashboard/inbox") || onChat;

  if (!inInbox)
    return <div className="flex-1 min-h-0 overflow-y-auto">{children}</div>;

  const activeId = onChat ? (pathname.split("/")[3] ?? null) : null;

  return (
    // 1. Changed "h-full" to "flex-1" so it fills exactly the space Next.js gives it
    <div className="flex-1 grid min-h-0 w-full lg:grid-cols-[22rem_minmax(0,1fr)]">
      {/* 2. Added "overflow-y-auto" here so the list scrolls INSIDE this column without breaking the grid */}
      <aside
        className={cn(
          "min-h-0 overflow-y-auto border-r bg-card",
          onChat ? "hidden lg:block" : "block",
        )}
      >
        <ChatList chats={chats} activeId={activeId} />
      </aside>

      {/* 3. Forced this section to be a flex column so your ChatThread scales properly */}
      <section
        className={cn(
          "flex flex-col min-h-0 min-w-0 bg-chat",
          onChat ? "flex" : "hidden lg:flex",
        )}
      >
        {children}
      </section>
    </div>
  );
}
