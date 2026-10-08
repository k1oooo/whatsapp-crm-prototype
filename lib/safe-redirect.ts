// Where to send the browser after a sign-in link, taken from a ?next= query value.
// Only a path on this same site is allowed. Anything else falls back to `fallback`, because
// `${origin}${next}` with next = "@evil.example" or ".evil.example" lands on another host.

export function safeNextPath(next: string | null | undefined, fallback = "/dashboard"): string {
  if (!next) return fallback;
  // One leading slash, then not another slash or a backslash ("//host" and "/\host" are protocol relative),
  // and no control characters that browsers strip before parsing.
  if (!/^\/(?![/\\])/.test(next) || /[\u0000-\u001f\u007f\\]/.test(next)) return fallback;
  try {
    // Belt and braces: it must still resolve to the same origin.
    const base = "https://app.invalid";
    if (new URL(next, base).origin !== base) return fallback;
  } catch {
    return fallback;
  }
  return next;
}
