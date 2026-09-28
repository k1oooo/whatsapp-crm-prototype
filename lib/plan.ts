import { stripe, stripeConfigured } from "@/lib/stripe";

export interface PlanPrice {
  /** "RM 49", "RM 49.90" */
  amount: string;
  /** "month", "year" */
  interval: string;
}

/** Pure so it can be tested. Whole amounts drop the ".00" ("RM 49", not "RM 49.00"). */
export function formatPlanPrice(unitAmount: number, currency: string, interval: string): PlanPrice {
  const whole = unitAmount % 100 === 0;
  const amount = new Intl.NumberFormat("en-MY", {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  })
    .format(unitAmount / 100)
    // Intl uses a non-breaking space between symbol and number; a plain one wraps and copies cleanly.
    .replace(/\u00a0/g, " ");
  return { amount, interval };
}

/**
 * The price the Subscribe button will actually charge, read from Stripe so the page can never
 * show a different number from checkout. Null when billing is not configured or the price
 * cannot be read: the page then just leaves the price out rather than guessing one.
 */
export async function getPlanPrice(): Promise<PlanPrice | null> {
  if (!stripeConfigured()) return null;
  try {
    const price = await stripe().prices.retrieve(process.env.STRIPE_PRICE_ID!);
    if (price.unit_amount == null || !price.recurring) return null;
    return formatPlanPrice(price.unit_amount, price.currency, price.recurring.interval);
  } catch (err) {
    console.error("Could not read the plan price from Stripe", err);
    return null;
  }
}
