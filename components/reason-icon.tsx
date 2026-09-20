import {
  Banknote,
  BadgePercent,
  CircleHelp,
  ClipboardCheck,
  Hourglass,
  Package,
  type LucideIcon,
} from "lucide-react";

const ICONS: Record<string, LucideIcon> = {
  discount: BadgePercent,
  stock: Package,
  payment: Banknote,
  approval: ClipboardCheck,
  unsure: CircleHelp,
};

export function ReasonIcon({ reason, className }: { reason: string | null; className?: string }) {
  const Icon = (reason && ICONS[reason]) || Hourglass;
  return <Icon className={className} aria-hidden />;
}
