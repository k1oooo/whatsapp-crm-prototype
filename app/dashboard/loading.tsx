import { PageShell } from "@/components/app/page-shell";
import { Skeleton } from "@/components/ui/skeleton";

// The fallback for every dashboard page that has no loading screen of its own.
export default function DashboardLoading() {
  return (
    <PageShell>
      <div aria-busy="true" className="flex flex-col gap-4 md:gap-6">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-4 w-72" />
        </div>
        <Skeleton className="h-32 rounded-xl" />
        <Skeleton className="h-40 rounded-xl" />
        <Skeleton className="h-28 rounded-xl" />
      </div>
    </PageShell>
  );
}
