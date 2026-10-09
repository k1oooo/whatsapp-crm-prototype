import { type NextRequest } from "next/server";
import type Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { stripe } from "@/lib/stripe";
import { syncSubscription } from "@/lib/stripe-sync";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const raw = await req.text();
  const signature = req.headers.get("stripe-signature");
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!signature || !secret) return new Response("Not configured", { status: 400 });

  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(raw, signature, secret);
  } catch (err) {
    console.error("Stripe webhook signature check failed", err);
    return new Response("Invalid signature", { status: 401 });
  }

  const admin = createAdminClient();

  try {
    switch (event.type) {
      // Checkout finished. The subscription itself (with our business_id metadata already on
      // it, from subscription_data.metadata at creation) is the source of truth, so fetch and
      // save that rather than trusting only the fields Stripe includes on the session.
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        if (typeof session.subscription === "string") {
          const sub = await stripe().subscriptions.retrieve(session.subscription);
          await syncSubscription(admin, sub);
        }
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        // Stripe does not promise delivery order, so this payload can be older than what it holds now (a late
        // "updated" must not bring back a subscription that has since ended). Ask Stripe for the current state.
        // A subscription that no longer exists falls back to the payload, which is the "deleted" case.
        const fromEvent = event.data.object as Stripe.Subscription;
        let current = fromEvent;
        try {
          current = await stripe().subscriptions.retrieve(fromEvent.id);
        } catch (err) {
          if ((err as { code?: string }).code !== "resource_missing") throw err;
        }
        await syncSubscription(admin, current);
        break;
      }
      default:
        break;
    }
  } catch (err) {
    console.error("Stripe webhook processing failed", event.type, err);
    return new Response("Processing failed", { status: 500 });
  }

  return new Response("ok", { status: 200 });
}
