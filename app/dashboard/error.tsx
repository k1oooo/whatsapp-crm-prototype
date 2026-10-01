"use client";

import { useEffect } from "react";
import { ErrorPanel } from "@/components/error-panel";

// Catches anything that throws while a dashboard page loads, so a failed query shows a clear
// message and a retry instead of looking like an empty list. This Next.js version passes a
// `retry` function (older versions call it `reset`).
export default function DashboardError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <ErrorPanel title="Something went wrong" onRetry={retry}>
      We could not load this page. Your chats and orders are safe. Try again, and if it keeps
      happening, check your connection or come back in a few minutes.
    </ErrorPanel>
  );
}
