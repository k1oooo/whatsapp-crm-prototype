"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function requestPasswordReset(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  if (!email) {
    redirect("/login/forgot-password?error=" + encodeURIComponent("Enter your email."));
  }

  const origin = (await headers()).get("origin") ?? "";
  const supabase = await createClient();

  // Errors here (rate limits, provider issues) are not shown to the caller: revealing whether
  // an email exists in the system is an account-enumeration risk, so the message is the same
  // either way. Real send failures still show up in the server logs.
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${origin}/auth/confirm?next=/login/reset-password`,
  });
  if (error) console.error("Password reset email failed", error.message);

  redirect("/login/forgot-password?sent=1");
}
