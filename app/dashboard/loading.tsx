import { Skeleton } from "@/components/ui/skeleton";

// Shown automatically by Next.js while app/dashboard/page.tsx's data fetch is in flight
// (see https://nextjs.org/docs/app/api-reference/file-conventions/loading). Mirrors the real
// page's shape so the layout doesn't jump once the data arrives.
export default function DashboardLoading() {
  return (
    <div
      className="flex h-full flex-col gap-6 overflow-hidden bg-muted/20 p-4 pb-24 md:gap-8 md:p-6 md:pb-8 lg:p-8"
      aria-busy="true"
    >
      <div className="flex items-center gap-3 md:gap-4">
        <Skeleton className="size-10 rounded-xl md:size-12" />
        <div className="flex flex-col gap-2">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-4 w-56" />
        </div>
      </div>

      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <li key={i} className="flex items-center gap-4 rounded-xl border bg-card p-5 md:p-6">
            <Skeleton className="size-10 shrink-0 rounded-xl md:size-12" />
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
  );
}
