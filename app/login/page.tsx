import { Shell, displayFont } from "@/components/Shell";
import { SubmitButton } from "@/components/SubmitButton";
import { signIn } from "./actions";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <Shell>
      <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6">
        <h1 className="text-4xl font-bold leading-tight tracking-tight" style={displayFont}>
          Don&apos;t let leads go cold.
        </h1>
        <p className="mt-3 text-[#55645E]">Sign in to see who to chase today.</p>

        <form action={signIn} className="mt-8 space-y-4">
          <label className="block text-sm font-medium">
            Email
            <input
              name="email"
              type="email"
              required
              autoComplete="email"
              className="mt-1 w-full rounded-lg border border-[#D8E0DA] bg-white px-3 py-2 text-base"
            />
          </label>
          <label className="block text-sm font-medium">
            Password
            <input
              name="password"
              type="password"
              required
              autoComplete="current-password"
              className="mt-1 w-full rounded-lg border border-[#D8E0DA] bg-white px-3 py-2 text-base"
            />
          </label>

          {error && (
            <p role="alert" className="text-sm text-[#B26A00]">
              {error}
            </p>
          )}

          <SubmitButton variant="primary" pendingText="Signing in...">
            Sign in
          </SubmitButton>
        </form>
      </main>
    </Shell>
  );
}
