import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { KeyRound, TriangleAlert } from "lucide-react";
import { SubmitButton } from "@/components/SubmitButton";
import { Card, CardContent } from "@/components/ui/card";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/server";
import { updatePassword } from "./actions";

export const metadata: Metadata = { title: "Choose a new password" };

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  // Only reachable with a valid recovery session from the /auth/confirm redirect.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login/forgot-password");

  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <KeyRound className="size-8 text-primary" aria-hidden />
          <h1 className="font-heading text-3xl leading-tight font-bold">Pick a new password</h1>
        </div>

        <Card>
          <CardContent className="p-6">
            <form action={updatePassword} className="flex flex-col gap-4">
              <div className="grid gap-1.5">
                <Label htmlFor="password">New password</Label>
                <PasswordInput
                  id="password"
                  name="password"
                  required
                  minLength={8}
                  autoComplete="new-password"
                  aria-describedby={error ? "password-hint form-error" : "password-hint"}
                />
                <p id="password-hint" className="text-sm text-muted-foreground">
                  At least 6 characters.
                </p>
              </div>

              {error && (
                <p
                  id="form-error"
                  role="alert"
                  className="flex items-start gap-2 rounded-lg bg-warning px-3 py-2 text-sm text-warning-foreground"
                >
                  <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                  {error}
                </p>
              )}

              <SubmitButton variant="default" size="lg" pendingText="Saving..." className="w-full">
                Save password
              </SubmitButton>
            </form>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
