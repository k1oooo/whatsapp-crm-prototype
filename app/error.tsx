"use client";

import { useEffect } from "react";
import { ErrorPanel } from "@/components/error-panel";

export default function RootError({
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
    <main className="flex min-h-dvh">
      <ErrorPanel title="Something went wrong" onRetry={retry} homeHref="/" homeLabel="Go to the home page">
        The page could not be shown. Try again in a moment.
      </ErrorPanel>
    </main>
  );
}
