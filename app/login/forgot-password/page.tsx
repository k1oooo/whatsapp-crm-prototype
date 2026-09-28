import Link from "next/link";
import { KeyRound, TriangleAlert } from "lucide-react";
import { SubmitButton } from "@/components/SubmitButton";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requestPasswordReset } from "./actions";

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; sent?: string }>;
}) {
  const { error, sent } = await searchParams;

  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <span className="flex size-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
            <KeyRound className="size-7" aria-hidden />
          </span>
          <h1 className="font-heading text-3xl leading-tight font-bold">Reset your password</h1>
          <p className="text-muted-foreground">We&apos;ll email you a link to pick a new one.</p>
        </div>

        <Card>
          <CardContent className="p-6">
            {sent ? (
              <p className="text-center text-sm text-muted-foreground">
                If an account exists for that email, a reset link is on its way. Check your inbox.
              </p>
            ) : (
              <form action={requestPasswordReset} className="flex flex-col gap-4">
                <div className="grid gap-1.5">
                  <Label htmlFor="email">Email</Label>
                  <Input id="email" name="email" type="email" required autoComplete="email" />
                </div>

                {error && (
                  <p
                    role="alert"
                    className="flex items-start gap-2 rounded-lg bg-warning px-3 py-2 text-sm text-warning-foreground"
                  >
                    <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                    {error}
                  </p>
                )}

                <SubmitButton variant="default" size="lg" pendingText="Sending..." className="w-full">
                  Send reset link
                </SubmitButton>
              </form>
            )}

            <p className="mt-4 text-center text-sm text-muted-foreground">
              <Link href="/login" className="font-medium text-foreground underline underline-offset-2">
                Back to sign in
              </Link>
            </p>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
