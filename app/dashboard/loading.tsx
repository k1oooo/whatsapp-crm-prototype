import { Shell } from "@/components/Shell";

export default function Loading() {
  return (
    <Shell>
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12" aria-busy="true">
        <div className="h-5 w-32 rounded bg-[#E3EAE5]" />
        <div className="mt-3 h-10 w-80 max-w-full rounded bg-[#E3EAE5]" />
        <div className="mt-10 space-y-3">
          <div className="h-44 rounded-xl bg-[#E3EAE5]" />
          <div className="h-44 rounded-xl bg-[#E3EAE5]" />
        </div>
      </main>
    </Shell>
  );
}
