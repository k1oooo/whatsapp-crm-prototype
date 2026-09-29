import type Stripe from "stripe";
import { stripe, stripeConfigured } from "@/lib/stripe";

export interface CardInfo {
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
}

export interface InvoiceRow {
  id: string;
  number: string | null;
  /** ISO date the invoice was created. */
  date: string;
  amount: string;
  status: "paid" | "open" | "void" | "uncollectible";
  url: string | null;
}

export interface BillingDetails {
  /** ISO. When the paid subscription began. */
  startedOn: string | null;
  /** ISO. Set when the owner cancelled and access runs until the period ends. */
  endsOn: string | null;
  card: CardInfo | null;
  /** What the next renewal will charge, e.g. "RM 49". */
  nextAmount: string | null;
  invoices: InvoiceRow[];
}

const BRAND: Record<string, string> = {
  visa: "Visa",
  mastercard: "Mastercard",
  amex: "American Express",
  unionpay: "UnionPay",
  jcb: "JCB",
  diners: "Diners Club",
  discover: "Discover",
};

/** Pure, so it can be tested. "visa" -> "Visa", unknown brands are capitalised as-is. */
export function cardLabel(card: Pick<CardInfo, "brand" | "last4">): string {
  const name = BRAND[card.brand] ?? (card.brand ? card.brand[0].toUpperCase() + card.brand.slice(1) : "Card");
  return `${name} ending ${card.last4}`;
}

/** "08/27". */
export function cardExpiry(card: Pick<CardInfo, "expMonth" | "expYear">): string {
  return `${String(card.expMonth).padStart(2, "0")}/${String(card.expYear).slice(-2)}`;
}

/** True when the card has expired, or expires this month or next, so the owner can be warned. */
export function cardExpiresSoon(card: Pick<CardInfo, "expMonth" | "expYear">, now = new Date()): boolean {
  const monthsLeft = (card.expYear - now.getFullYear()) * 12 + (card.expMonth - (now.getMonth() + 1));
  return monthsLeft <= 1;
}

/** Whole amounts drop ".00", like getPlanPrice. Amounts are in the currency's minor unit. */
export function formatMoney(minor: number, currency: string): string {
  const whole = minor % 100 === 0;
  return new Intl.NumberFormat("en-MY", {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  })
    .format(minor / 100)
    .replace(/\u00a0/g, " ");
}

function pickCard(pm: string | Stripe.PaymentMethod | null | undefined): CardInfo | null {
  if (!pm || typeof pm === "string" || !pm.card) return null;
  return {
    brand: pm.card.brand,
    last4: pm.card.last4,
    expMonth: pm.card.exp_month,
    expYear: pm.card.exp_year,
  };
}

const iso = (unix: number | null | undefined) => (unix ? new Date(unix * 1000).toISOString() : null);

/**
 * Live details Stripe knows and our table does not: card on file, cancellation, invoices.
 * Null when billing is off, there is no subscription yet, or Stripe cannot be reached. The page
 * then shows only what the database already has instead of failing.
 */
export async function getBillingDetails(
  subscriptionId: string | null,
  customerId: string | null,
): Promise<BillingDetails | null> {
  if (!stripeConfigured() || !subscriptionId || !customerId) return null;
  try {
    const client = stripe();
    const [sub, list] = await Promise.all([
      client.subscriptions.retrieve(subscriptionId, { expand: ["default_payment_method"] }),
      client.invoices.list({ customer: customerId, limit: 12 }),
    ]);

    let card = pickCard(sub.default_payment_method);
    if (!card) {
      // Checkout can store the card on the customer instead of the subscription.
      const customer = await client.customers.retrieve(customerId, {
        expand: ["invoice_settings.default_payment_method"],
      });
      if (!customer.deleted) card = pickCard(customer.invoice_settings?.default_payment_method);
    }

    const item = sub.items.data[0];
    const nextAmount =
      item?.price.unit_amount != null
        ? formatMoney(item.price.unit_amount * (item.quantity ?? 1), item.price.currency)
        : null;

    const invoices: InvoiceRow[] = list.data
      .filter((i): i is Stripe.Invoice & { id: string; status: InvoiceRow["status"] } =>
        !!i.id && !!i.status && i.status !== "draft",
      )
      .map((i) => ({
        id: i.id,
        number: i.number,
        date: new Date(i.created * 1000).toISOString(),
        amount: formatMoney(i.status === "paid" ? i.amount_paid : i.amount_due, i.currency),
        status: i.status,
        url: i.hosted_invoice_url ?? null,
      }));

    return {
      startedOn: iso(sub.start_date),
      endsOn: sub.cancel_at_period_end ? iso(item?.current_period_end ?? sub.cancel_at) : iso(sub.cancel_at),
      card,
      nextAmount,
      invoices,
    };
  } catch (err) {
    console.error("Could not read billing details from Stripe", err);
    return null;
  }
}
