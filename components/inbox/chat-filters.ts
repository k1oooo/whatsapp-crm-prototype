import { ORDER_LABEL, STAGES, STAGE_LABEL, type ChatSummary, type Stage } from "@/lib/leads";

export type FilterId =
  | "needs_you"
  | "waiting_payment"
  | "paid"
  | "quiet"
  | `stage_${Stage}`;

export interface FilterOption {
  id: FilterId;
  label: string;
  test: (chat: ChatSummary) => boolean;
}

export const STATUS_FILTERS: FilterOption[] = [
  { id: "needs_you", label: "Needs you", test: (c) => c.needsYou },
  { id: "waiting_payment", label: ORDER_LABEL.confirmed ?? "Waiting for payment", test: (c) => c.orderStatus === "confirmed" },
  { id: "paid", label: ORDER_LABEL.paid ?? "Paid", test: (c) => c.orderStatus === "paid" },
  { id: "quiet", label: "Quiet", test: (c) => c.cold && !c.needsYou },
];

export const STAGE_FILTERS: FilterOption[] = STAGES.map((stage) => ({
  id: `stage_${stage}` as FilterId,
  label: STAGE_LABEL[stage],
  test: (c) => c.stage === stage,
}));

export const ALL_FILTERS: FilterOption[] = [...STATUS_FILTERS, ...STAGE_FILTERS];

/** A chat matches when it satisfies at least one selected filter (no filters selected shows everyone). */
export function matchesFilters(chat: ChatSummary, selected: Set<FilterId>): boolean {
  if (selected.size === 0) return true;
  return ALL_FILTERS.some((f) => selected.has(f.id) && f.test(chat));
}
