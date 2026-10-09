"use server";

import { redirect } from "next/navigation";
import { passwordProblem } from "@/lib/password-policy";
import { createClient } from "@/lib/supabase/server";

export async function updatePassword(formData: FormData) {
  const password = String(formData.get("password") ?? "");
  const problem = passwordProblem(password);
  if (problem) redirect("/login/reset-password?error=" + encodeURIComponent(problem));

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    redirect("/login/reset-password?error=" + encodeURIComponent(error.message));
  }

  redirect("/dashboard");
}
