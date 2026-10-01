import { PageShell } from "@/components/app/page-shell";
import { Skeleton } from "@/components/ui/skeleton";

// Shown while the Overview's data is loading. Mirrors the real page so nothing jumps.
export default function OverviewLoading() {
  return (
    <PageShell size="wide" className="bg-muted/20">
      <div aria-busy="true" className="flex flex-col gap-4 md:gap-6">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-4 w-64" />
        </div>

        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {[0, 1].map((i) => (
            <li key={i} className="flex items-center gap-4 rounded-xl border bg-card p-5 md:p-6">
              <Skeleton className="size-5 shrink-0 rounded-md md:size-6" />
              <div className="flex flex-col gap-2">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-6 w-12" />
              </div>
            </li>
          ))}
        </ul>

        <ul className="grid grid-cols-2 gap-3 md:gap-4 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <li key={i} className="flex flex-col gap-3 rounded-xl border bg-card p-4 md:p-5">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-6 w-16" />
              <Skeleton className="h-3 w-24" />
            </li>
          ))}
        </ul>

        <div className="grid grid-cols-1 gap-4 md:gap-6 lg:grid-cols-3">
          <Skeleton className="h-64 rounded-xl lg:col-span-1" />
          <Skeleton className="h-64 rounded-xl lg:col-span-2" />
        </div>
      </div>
    </PageShell>
  );
}
