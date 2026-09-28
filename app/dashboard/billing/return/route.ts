import { revalidatePath } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";
import { stripe } from "@/lib/stripe";
import { reconcileCheckoutSession } from "@/lib/stripe-sync";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

// Stripe Checkout sends the owner here after paying (see startCheckout's success_url). It asks
// Stripe what happened and saves it BEFORE showing the billing page, so the page and the
// "assistant is paused" banner are already right on the first paint, and it does not matter
// whether the webhook has arrived yet.
export async function GET(req: NextRequest) {
  const to = req.nextUrl.clone();
  to.pathname = "/dashboard/billing";
  to.search = "";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    to.pathname = "/login";
    return NextResponse.redirect(to);
  }

  const sessionId = req.nextUrl.searchParams.get("session_id");
  let confirmed = false;

  if (sessionId) {
    const { data: business } = await supabase.from("businesses").select("id").eq("owner_id", user.id).maybeSingle();
    if (business) {
      try {
        confirmed = await reconcileCheckoutSession(createAdminClient(), stripe(), sessionId, business.id);
      } catch (err) {
        // Not fatal: the webhook will still update the subscription, and the billing page
        // keeps checking for a few seconds when it lands with checkout=success but no update.
        console.error("Could not confirm the checkout with Stripe", err);
      }
    }
  }

  revalidatePath("/dashboard", "layout");
  to.searchParams.set("checkout", "success");
  if (!confirmed) to.searchParams.set("confirm", "pending");
  return NextResponse.redirect(to);
}
