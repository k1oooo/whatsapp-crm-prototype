// Webhook signature verification.
import crypto from "node:crypto";

/* ---------- Signature verification ---------- */

// The secret is resolved by the caller: it may be a business's own wa_app_secret (their own Meta
// app), or the deployment's shared WHATSAPP_APP_SECRET for businesses that don't have their own.
export function verifySignature(rawBody: string, header: string | null, secret: string | undefined): boolean {
  if (!secret || !header?.startsWith("sha256=")) return false;

  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const received = header.slice("sha256=".length);

  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(received, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
