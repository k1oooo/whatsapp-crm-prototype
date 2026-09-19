// Shared lead types and small helpers for the dashboard.

export const STAGES = ["new", "talking", "quoted", "won", "lost"] as const;
export type Stage = (typeof STAGES)[number];

export const STAGE_LABEL: Record<Stage, string> = {
  new: "New",
  talking: "Talking",
  quoted: "Quoted",
  won: "Won",
  lost: "Lost",
};

// Dot color next to each pipeline column heading.
export const STAGE_DOT: Record<Stage, string> = {
  new: "#8A9A92",
  talking: "#2F6DB5",
  quoted: "#B26A00",
  won: "#1F7A5C",
  lost: "#B8C2BC",
};

export interface Lead {
  id: string;
  wa_contact_number: string;
  name: string | null;
  need: string | null;
  budget_myr: number | null;
  quoted_price_myr: number | null;
  deadline: string | null; // YYYY-MM-DD
  stage: Stage;
  language: string | null;
  last_message_at: string | null;
  last_chased_at: string | null;
  locked_fields: string[];
}

export interface Draft {
  id: string;
  lead_id: string;
  body: string;
  created_at: string;
}

export interface LastMessage {
  lead_id: string;
  direction: "in" | "out";
  body: string | null;
  sent_at: string;
}

export const LEAD_COLUMNS =
  "id, wa_contact_number, name, need, budget_myr, quoted_price_myr, deadline, stage, language, last_message_at, last_chased_at, locked_fields";

const DAY = 86_400_000;

/** The most recent time anyone touched this lead: a chat message or a follow-up you marked as sent. */
export function lastTouch(lead: Lead): string | null {
  const a = lead.last_message_at;
  const b = lead.last_chased_at;
  if (a && b) return new Date(a) > new Date(b) ? a : b;
  return a ?? b;
}

export function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / DAY));
}

/** True when the customer wrote last and you have not answered or followed up since. */
export function owesReply(
  lead: Lead,
  last?: { direction: "in" | "out"; sent_at: string },
): boolean {
  if (!last || last.direction !== "in") return false;
  if (lead.last_chased_at && new Date(lead.last_chased_at) > new Date(last.sent_at)) return false;
  return true;
}

export function isOpen(stage: Stage): boolean {
  return stage === "new" || stage === "talking" || stage === "quoted";
}

export function isCold(lead: Lead, coldAfterDays: number): boolean {
  const quiet = daysSince(lastTouch(lead));
  return isOpen(lead.stage) && quiet !== null && quiet >= coldAfterDays;
}

/** Days until the deadline, counted in Malaysia time. Negative means it has passed. */
export function daysUntil(deadline: string): number {
  const end = new Date(`${deadline}T23:59:59+08:00`).getTime();
  return Math.ceil((end - Date.now()) / DAY) - 1;
}

export function formatDeadline(deadline: string): string {
  return new Date(`${deadline}T12:00:00+08:00`).toLocaleDateString("en-MY", {
    day: "numeric",
    month: "short",
  });
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleString("en-MY", {
    timeZone: "Asia/Kuala_Lumpur",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function rm(amount: number): string {
  return `RM${amount.toLocaleString("en-MY")}`;
}

export function displayName(lead: Lead): string {
  return lead.name ?? `+${lead.wa_contact_number}`;
}

export function relativeDays(iso: string | null): string {
  const d = daysSince(iso);
  if (d === null) return "";
  if (d === 0) return "today";
  return d === 1 ? "1 day ago" : `${d} days ago`;
}

export function waLink(number: string, text: string): string {
  return `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
}
