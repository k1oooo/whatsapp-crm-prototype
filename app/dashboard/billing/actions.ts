"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { stripe, stripeConfigured } from "@/lib/stripe";

async function currentBusiness(supabase: Awaited<ReturnType<typeof createClient>>) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: business } = await supabase
    .from("businesses")
    .select("id, name")
    .eq("owner_id", user.id)
    .maybeSingle();
  if (!business) redirect("/dashboard");

  const { data: subscription } = await supabase
    .from("subscriptions")
    .select("stripe_customer_id, status")
    .eq("business_id", business.id)
    .maybeSingle();

  return {
    business,
    stripeCustomerId: subscription?.stripe_customer_id ?? null,
    status: (subscription?.status as string | undefined) ?? null,
  };
}

async function origin(): Promise<string> {
  const h = await headers();
  const configured = process.env.NEXT_PUBLIC_APP_URL;
  if (configured) return configured.replace(/\/$/, "");
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "https";
  return `${proto}://${host}`;
}

/** Owner clicks "Subscribe": sends them to Stripe's hosted checkout for the one flat plan. */
export async function startCheckout(): Promise<{ error?: string }> {
  if (!stripeConfigured()) {
    return { error: "Billing is not set up yet. Add STRIPE_SECRET_KEY and STRIPE_PRICE_ID to enable it." };
  }

  const supabase = await createClient();
  const { business, stripeCustomerId, status } = await currentBusiness(supabase);

  // Checked here, not just by hiding the button: a stale tab or a double click must never
  // start a second subscription for someone who already has a live one.
  if (status === "active" || status === "past_due") {
    return { error: "You already have a subscription. Use Manage billing to change it." };
  }
  const base = await origin();

  let session;
  try {
    session = await stripe().checkout.sessions.create({
      mode: "subscription",
      customer: stripeCustomerId ?? undefined,
      client_reference_id: business.id,
      line_items: [{ price: process.env.STRIPE_PRICE_ID!, quantity: 1 }],
      subscription_data: { metadata: { business_id: business.id } },
      success_url: `${base}/dashboard/billing/return?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${base}/dashboard/billing?checkout=cancelled`,
    });
  } catch (err) {
    console.error("Could not start Stripe checkout", err);
    return { error: "Could not start checkout. Try again in a moment." };
  }

  if (!session.url) return { error: "Stripe did not return a checkout link. Try again." };
  redirect(session.url);
}

/** Owner clicks "Manage billing": Stripe's hosted portal for updating a card or cancelling. */
export async function openBillingPortal(): Promise<{ error?: string }> {
  if (!stripeConfigured()) {
    return { error: "Billing is not set up yet." };
  }

  const supabase = await createClient();
  const { stripeCustomerId } = await currentBusiness(supabase);
  if (!stripeCustomerId) {
    return { error: "Subscribe first — there is nothing to manage yet." };
  }

  const base = await origin();
  let session;
  try {
    session = await stripe().billingPortal.sessions.create({
      customer: stripeCustomerId,
      return_url: `${base}/dashboard/billing`,
    });
  } catch (err) {
    console.error("Could not open Stripe billing portal", err);
    return { error: "Could not open the billing portal. Try again in a moment." };
  }

  redirect(session.url);
}
