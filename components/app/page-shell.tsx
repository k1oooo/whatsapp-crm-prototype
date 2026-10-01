import { cn } from "@/lib/utils";

// The scrolling frame every dashboard page sits in. The shared <main> in the dashboard layout
// does not scroll by itself, so each page needs this wrapper. `scroll-stable` reserves the
// scrollbar's width so switching between a short and a tall tab does not shift the page sideways.
//
// form    = a single column of settings (max-w-3xl)
// content = lists and tabs (max-w-5xl)
// wide    = dashboards that use the full width
const WIDTH = {
  form: "max-w-3xl",
  content: "max-w-5xl",
  wide: "max-w-none",
} as const;

export function PageShell({
  size = "content",
  className,
  children,
}: {
  size?: keyof typeof WIDTH;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("min-h-0 w-full flex-1 overflow-y-auto overflow-x-hidden scroll-stable", className)}>
      <div className={cn("mx-auto flex w-full flex-col gap-4 p-4 sm:p-6 md:gap-6 lg:p-8", WIDTH[size])}>
        {children}
      </div>
    </div>
  );
}

// One page title style for the whole product.
export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("flex flex-wrap items-start justify-between gap-4", className)}>
      <div className="min-w-0">
        <h1 className="font-heading text-2xl font-bold md:text-3xl">{title}</h1>
        {description && (
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground md:text-base">{description}</p>
        )}
      </div>
      {actions && <div className="flex w-full shrink-0 flex-wrap gap-2 md:w-auto">{actions}</div>}
    </header>
  );
}
