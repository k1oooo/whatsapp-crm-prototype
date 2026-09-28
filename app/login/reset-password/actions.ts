"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function updatePassword(formData: FormData) {
  const password = String(formData.get("password") ?? "");
  if (password.length < 6) {
    redirect(
      "/login/reset-password?error=" + encodeURIComponent("Password must be at least 6 characters."),
    );
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    redirect("/login/reset-password?error=" + encodeURIComponent(error.message));
  }

  redirect("/dashboard");
}
