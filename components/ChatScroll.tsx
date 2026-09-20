"use client";

import { useEffect, useRef } from "react";

// The conversation scrolls inside its own box and opens at the newest message,
// so the whole page does not have to scroll.
export function ChatScroll({ count, children }: { count: number; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [count]);

  return (
    <div
      ref={ref}
      tabIndex={0}
      role="region"
      aria-label="Conversation"
      className="mt-2 max-h-[60vh] min-h-40 overflow-y-auto rounded-xl border border-[#D8E0DA] bg-[#FBFCFB] p-4 focus-visible:outline-2 focus-visible:outline-[#1F7A5C] lg:max-h-none lg:min-h-0 lg:flex-1"
    >
      {children}
    </div>
  );
}
