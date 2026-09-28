import { MailCheck } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

export default async function CheckEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string }>;
}) {
  const { email } = await searchParams;

  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <div className="w-full max-w-sm text-center">
        <Card>
          <CardContent className="flex flex-col items-center gap-3 p-6">
            <span className="flex size-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
              <MailCheck className="size-7" aria-hidden />
            </span>
            <h1 className="font-heading text-2xl font-bold">Check your email</h1>
            <p className="text-muted-foreground">
              We sent a confirmation link{email ? ` to ${email}` : ""}. Open it to activate your
              account, then sign in.
            </p>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
