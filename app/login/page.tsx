import type { Metadata } from "next";
import Link from "next/link";
import { MessagesSquare, TriangleAlert } from "lucide-react";
import { SubmitButton } from "@/components/SubmitButton";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { signIn } from "./actions";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <MessagesSquare className="size-8 text-primary" aria-hidden />
          <h1 className="font-heading text-3xl leading-tight font-bold">Welcome back</h1>
          <p className="text-muted-foreground">Sign in to see what needs you today.</p>
        </div>

        <Card>
          <CardContent className="p-6">
            <form action={signIn} className="flex flex-col gap-4">
              <div className="grid gap-1.5">
                <Label htmlFor="email">Email</Label>
                <Input id="email" name="email" type="email" required autoComplete="email" aria-invalid={error ? true : undefined} aria-describedby={error ? "form-error" : undefined} />
              </div>
              <div className="grid gap-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password">Password</Label>
                  <Link
                    href="/login/forgot-password"
                    className="text-sm text-muted-foreground underline underline-offset-2 hover:text-foreground"
                  >
                    Forgot password?
                  </Link>
                </div>
                <PasswordInput id="password" name="password" required autoComplete="current-password" aria-invalid={error ? true : undefined} aria-describedby={error ? "form-error" : undefined} />
              </div>

              {error && (
                <p id="form-error" role="alert" className="flex items-start gap-2 rounded-lg bg-warning px-3 py-2 text-sm text-warning-foreground">
                  <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                  {error}
                </p>
              )}

              <SubmitButton variant="default" size="lg" pendingText="Signing in..." className="w-full">
                Sign in
              </SubmitButton>
            </form>

            <p className="mt-4 text-center text-sm text-muted-foreground">
              New here?{" "}
              <Link href="/signup" className="font-medium text-foreground underline underline-offset-2">
                Create an account
              </Link>
            </p>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
