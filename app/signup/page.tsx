import type { Metadata } from "next";
import Link from "next/link";
import { MessagesSquare, TriangleAlert } from "lucide-react";
import { SubmitButton } from "@/components/SubmitButton";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { signUp } from "./actions";

export const metadata: Metadata = { title: "Create your account" };

export default async function SignupPage({
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
          <h1 className="font-heading text-3xl leading-tight font-bold">Create your account</h1>
          <p className="text-muted-foreground">
            Set up your business, then connect WhatsApp in a minute.
          </p>
        </div>

        <Card>
          <CardContent className="p-6">
            <form action={signUp} className="flex flex-col gap-4">
              <div className="grid gap-1.5">
                <Label htmlFor="business_name">Business name</Label>
                <Input
                  id="business_name"
                  name="business_name"
                  required
                  autoComplete="organization"
                  placeholder="Test Bakery"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="email">Email</Label>
                <Input id="email" name="email" type="email" required autoComplete="email" />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="password">Password</Label>
                <PasswordInput
                  id="password"
                  name="password"
                  required
                  minLength={6}
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

              <SubmitButton variant="default" size="lg" pendingText="Creating your account..." className="w-full">
                Create account
              </SubmitButton>
            </form>

            <p className="mt-4 text-center text-sm text-muted-foreground">
              Already have an account?{" "}
              <Link href="/login" className="font-medium text-foreground underline underline-offset-2">
                Sign in
              </Link>
            </p>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
