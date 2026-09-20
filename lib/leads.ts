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
  pending_decision: boolean;
  human_reason: string | null;
  handoff_note: string | null;
  order_status: string | null;
  order_summary: string | null;
}

export const ORDER_LABEL: Record<string, string> = {
  collecting: "Taking the order",
  awaiting_confirmation: "Waiting for the customer to confirm",
  confirmed: "Confirmed, waiting for payment",
  paid: "Paid",
};

// Why the assistant handed a chat to the owner.
export const REASON_LABEL: Record<string, string> = {
  discount: "asked for a discount",
  stock: "asked about stock or availability",
  payment: "payment to check",
  unsure: "the assistant was not sure",
};

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
  "id, wa_contact_number, name, need, budget_myr, quoted_price_myr, deadline, stage, language, last_message_at, last_chased_at, locked_fields, pending_decision, human_reason, handoff_note, order_status, order_summary";

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

/* ---------- Inbox helpers ---------- */

/** One chat in the inbox list. Plain data, so it can be passed to client components. */
export interface ChatSummary {
  id: string;
  name: string;
  number: string;
  hasName: boolean;
  stage: Stage;
  needsYou: boolean;
  reason: string | null;
  note: string | null;
  orderStatus: string | null;
  quote: number | null;
  lastBody: string | null;
  lastDirection: "in" | "out" | null;
  lastSource: string | null;
  lastAt: string | null;
}

export function initials(name: string): string {
  const parts = name.replace(/^\+/, "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

const KL = "Asia/Kuala_Lumpur";

function klDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: KL }); // YYYY-MM-DD
}

/** "5:48 pm" today, "Yesterday", or "20 Sept". Used in the chat list. */
export function chatTime(iso: string | null): string {
  if (!iso) return "";
  const day = klDate(iso);
  const today = klDate(new Date().toISOString());
  const yesterday = klDate(new Date(Date.now() - 86_400_000).toISOString());
  if (day === today) {
    return new Date(iso).toLocaleTimeString("en-MY", { timeZone: KL, hour: "numeric", minute: "2-digit" });
  }
  if (day === yesterday) return "Yesterday";
  return new Date(iso).toLocaleDateString("en-MY", { timeZone: KL, day: "numeric", month: "short" });
}

/** "Today", "Yesterday" or "20 Sept". Used for day dividers inside a chat. */
export function dayLabel(iso: string): string {
  const day = klDate(iso);
  const today = klDate(new Date().toISOString());
  const yesterday = klDate(new Date(Date.now() - 86_400_000).toISOString());
  if (day === today) return "Today";
  if (day === yesterday) return "Yesterday";
  return new Date(iso).toLocaleDateString("en-MY", { timeZone: KL, day: "numeric", month: "long" });
}

export function dayKey(iso: string): string {
  return klDate(iso);
}

export function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-MY", { timeZone: KL, hour: "numeric", minute: "2-digit" });
}

/** Photos, voice notes and files are stored as "[image]" and similar. Show them in words. */
export function previewText(body: string | null): string {
  if (!body) return "";
  const media = body.trim().match(/^\[([a-z_]+)\]$/);
  if (!media) return body;
  const labels: Record<string, string> = {
    image: "Photo",
    audio: "Voice note",
    voice: "Voice note",
    document: "File",
    video: "Video",
    sticker: "Sticker",
  };
  return labels[media[1]] ?? "Attachment";
}

export function isMedia(body: string | null): boolean {
  return !!body && /^\[[a-z_]+\]$/.test(body.trim());
}

/**
 * The assistant writes the order as one line, like
 * "15 cupcakes (5 chocolate, 10 red velvet), Pickup Tue 22 Sept 2pm Wangsa Maju, Jett, RM45".
 * Split it into what was ordered and when/where, and drop the name and price, which are shown elsewhere.
 */
export function parseOrderSummary(
  summary: string,
  customerName: string | null,
): { items: string; where: string | null } {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of summary) {
    if (ch === "(") depth++;
    if (ch === ")") depth = Math.max(0, depth - 1);
    if (ch === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current.trim());

  const name = customerName?.trim().toLowerCase();
  const rest = parts
    .slice(1)
    .filter((p) => p && !/^RM\s?\d/i.test(p) && !(name && p.toLowerCase() === name));

  const where = rest.length ? rest.join(", ") : null;
  return {
    items: parts[0] || summary,
    where: where ? where.charAt(0).toUpperCase() + where.slice(1) : null,
  };
}
