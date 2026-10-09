"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { passwordProblem } from "@/lib/password-policy";
import { createClient } from "@/lib/supabase/server";

export async function signUp(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const businessName = String(formData.get("business_name") ?? "").trim();

  if (!businessName) {
    redirect("/signup?error=" + encodeURIComponent("Add your business name."));
  }

  const problem = passwordProblem(password);
  if (problem) redirect("/signup?error=" + encodeURIComponent(problem));

  const origin = (await headers()).get("origin") ?? "";
  const supabase = await createClient();

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      // Read by the dashboard the first time this owner shows up, to name their business row.
      data: { business_name: businessName },
      emailRedirectTo: `${origin}/auth/confirm?next=/dashboard`,
    },
  });

  if (error) {
    // Do not echo Supabase's wording: "already registered" would tell a stranger which emails have accounts.
    console.error("Sign up failed", error.code ?? error.message);
    const message =
      error.code === "weak_password" || error.status === 422
        ? "Could not create the account. Check your email and use a stronger password."
        : "Could not create the account. If you already have one, sign in or reset your password.";
    redirect("/signup?error=" + encodeURIComponent(message));
  }

  // Email confirmation is off for this Supabase project, so we already have a session.
  if (data.session) redirect("/dashboard");

  // Otherwise Supabase emailed a confirmation link; the account exists but isn't signed in yet.
  redirect("/signup/check-email?email=" + encodeURIComponent(email));
}
