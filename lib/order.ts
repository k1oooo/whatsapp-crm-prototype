// Order totals, computed by the server from the menu's fixed prices. The AI only says WHICH items and
// HOW MANY; it never adds prices up. That keeps a wrong total (and a wrong revenue figure) out of the
// system, and means a price the AI makes up can be caught exactly instead of guessed at.

export interface CatalogItem {
  /** Short code the AI refers to, such as "P1". Only valid for one prompt. */
  code: string;
  entryId: string;
  title: string;
  priceMyr: number;
}

/** What the AI sends back: an item code and a quantity. */
export interface OrderLineInput {
  item: string;
  qty: number;
}

/** What is stored on the order. Title and price are copied, so editing the menu later changes nothing already sold. */
export interface OrderLine {
  entry_id: string;
  title: string;
  qty: number;
  unit_myr: number;
  subtotal_myr: number;
}

export const MAX_LINE_QTY = 1000;
export const MAX_ORDER_LINES = 20;
export const TOTAL_TOKEN = "{TOTAL}";

export const round2 = (n: number) => Math.round(n * 100) / 100;

/** "RM36" or "RM36.50". */
export function formatMyr(n: number): string {
  const v = round2(n);
  return Number.isInteger(v) ? `RM${v}` : `RM${v.toFixed(2)}`;
}

/** What an owner may type as a price: "3", "3.50", "3,50" or "RM3.50". Empty means no price. */
export function parsePrice(raw: string, max = 100_000): number | null | "invalid" {
  const text = raw.trim().replace(/^rm\s*/i, "");
  if (!text) return null;
  if (!/^\d{1,6}([.,]\d{1,2})?$/.test(text)) return "invalid";
  const n = round2(Number(text.replace(",", ".")));
  return n > max ? "invalid" : n;
}

/** Give every priced menu entry a code (P1, P2, ...) in the order the entries are given. */
export function buildCatalog(
  entries: { id: string; title: string; price_myr?: number | null }[],
): CatalogItem[] {
  const items: CatalogItem[] = [];
  for (const e of entries) {
    const price = e.price_myr == null ? NaN : Number(e.price_myr);
    if (!Number.isFinite(price) || price < 0) continue;
    items.push({ code: `P${items.length + 1}`, entryId: e.id, title: e.title, priceMyr: round2(price) });
  }
  return items;
}

export type Computed =
  | { ok: true; lines: OrderLine[]; totalMyr: number }
  | { ok: false; error: string };

/** Turn the AI's lines into priced lines and a total. Anything it cannot vouch for is an error. */
export function computeOrder(lines: OrderLineInput[], catalog: CatalogItem[]): Computed {
  if (lines.length === 0) return { ok: false, error: "no order lines" };
  if (lines.length > MAX_ORDER_LINES) return { ok: false, error: "too many order lines" };

  const byCode = new Map(catalog.map((c) => [c.code.toUpperCase(), c]));
  const merged = new Map<string, OrderLine>();
  for (const l of lines) {
    const item = byCode.get(String(l.item).trim().toUpperCase());
    if (!item) return { ok: false, error: `unknown item "${l.item}"` };
    if (!Number.isInteger(l.qty) || l.qty < 1 || l.qty > MAX_LINE_QTY) {
      return { ok: false, error: `bad quantity for ${item.title}` };
    }
    const prev = merged.get(item.entryId);
    const qty = (prev?.qty ?? 0) + l.qty;
    if (qty > MAX_LINE_QTY) return { ok: false, error: `bad quantity for ${item.title}` };
    merged.set(item.entryId, {
      entry_id: item.entryId,
      title: item.title,
      qty,
      unit_myr: item.priceMyr,
      subtotal_myr: round2(item.priceMyr * qty),
    });
  }
  const out = [...merged.values()];
  return { ok: true, lines: out, totalMyr: round2(out.reduce((s, l) => s + l.subtotal_myr, 0)) };
}

/** Lines saved on a lead or draft, read back defensively (it is a jsonb column). */
export function parseStoredLines(raw: unknown): OrderLine[] {
  if (!Array.isArray(raw)) return [];
  const out: OrderLine[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const qty = Number(o.qty);
    const unit = Number(o.unit_myr);
    if (typeof o.entry_id !== "string" || typeof o.title !== "string") continue;
    if (!Number.isInteger(qty) || qty < 1 || !Number.isFinite(unit) || unit < 0) continue;
    out.push({ entry_id: o.entry_id, title: o.title, qty, unit_myr: round2(unit), subtotal_myr: round2(unit * qty) });
  }
  return out;
}

/** Every amount a computed order makes legitimate to mention: each unit price, each line, the total. */
export function computedAmounts(lines: OrderLine[], totalMyr: number | null): number[] {
  const set = new Set<number>();
  for (const l of lines) {
    set.add(l.unit_myr);
    set.add(l.subtotal_myr);
  }
  if (totalMyr != null) set.add(round2(totalMyr));
  return [...set];
}

/** Replace {TOTAL} with the real amount. `ok` is false if the reply asks for a total we do not have. */
export function fillTotal(reply: string, totalMyr: number | null): { reply: string; ok: boolean } {
  if (!reply.includes(TOTAL_TOKEN)) return { reply, ok: true };
  if (totalMyr == null) return { reply, ok: false };
  return { reply: reply.split(TOTAL_TOKEN).join(formatMyr(totalMyr)), ok: true };
}

// "RM1,200.50" (thousands grouping), "RM3.50" or "RM3,50" (decimal), "RM36" (whole).
const AMOUNT = /RM\s?(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+[.,]\d{1,2}(?!\d)|\d+)/gi;

function amountsIn(text: string): number[] {
  return [...text.matchAll(AMOUNT)].map((m) => {
    const raw = m[1];
    return round2(Number(/^\d{1,3}(,\d{3})+/.test(raw) ? raw.replace(/,/g, "") : raw.replace(",", ".")));
  });
}

/**
 * Strict price check, used when the business has priced menu items. A figure in the reply must be one
 * of: an amount written in the business facts, an amount the customer wrote, or an amount the server
 * computed. There is no "any sum of a few prices", which is what lets an invented number through.
 */
export function hasUnverifiedAmount(
  reply: string,
  factsText: string,
  chatText: string,
  computed: number[],
): boolean {
  const allowed = new Set<number>([...amountsIn(factsText), ...amountsIn(chatText), ...computed.map(round2)]);
  return amountsIn(reply).some((x) => !allowed.has(x));
}
