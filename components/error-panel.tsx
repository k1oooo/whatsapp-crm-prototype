import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

// The page shown when something breaks or cannot be found. It says what happened and what to do.
export function ErrorPanel({
  title,
  children,
  onRetry,
  homeHref = "/dashboard",
  homeLabel = "Back to Overview",
}: {
  title: string;
  children: React.ReactNode;
  onRetry?: () => void;
  homeHref?: string;
  homeLabel?: string;
}) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-6">
      <div role="alert" className="flex max-w-md flex-col items-center gap-3 text-center">
        <TriangleAlert className="size-8 text-warning-foreground" aria-hidden />
        <h1 className="font-heading text-xl font-bold md:text-2xl">{title}</h1>
        <p className="text-muted-foreground">{children}</p>
        <div className="mt-2 flex flex-wrap justify-center gap-2">
          {onRetry && <Button onClick={onRetry}>Try again</Button>}
          <Button asChild variant="outline">
            <Link href={homeHref}>{homeLabel}</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
