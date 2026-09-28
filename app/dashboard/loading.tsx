import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div
      className="flex h-full flex-col gap-4 p-4 md:p-6 lg:p-8"
      aria-busy="true"
    >
      <Skeleton className="h-8 w-48 md:h-10 md:w-64" />
      <Skeleton className="h-20 w-full md:h-24" />
      <Skeleton className="h-20 w-full md:h-24" />
      <Skeleton className="h-20 w-full md:h-24 md:w-2/3" />
    </div>
  );
}
