import { ErrorPanel } from "@/components/error-panel";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh">
      <ErrorPanel title="Page not found" homeHref="/" homeLabel="Go to the home page">
        The page you are looking for does not exist or has moved.
      </ErrorPanel>
    </main>
  );
}
