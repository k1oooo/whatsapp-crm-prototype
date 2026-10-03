// Encryption at rest for the WhatsApp credentials a business saves (access token, app secret).
//
// The owner's browser session can read its own businesses row (RLS "select" returns every column),
// so a stolen session or an XSS bug would hand over live WhatsApp credentials. Stored as AES-256-GCM
// ciphertext they are useless without WA_SECRETS_KEY, which only the server has.
//
// Format: enc:v1:<iv>:<tag>:<ciphertext>, each part base64url. A value without that prefix is a
// legacy plaintext one and is still read as is, so existing rows keep working until
// scripts/encrypt-existing-secrets.mjs has run.
import crypto from "node:crypto";

const PREFIX = "enc:v1:";

/** The 32-byte key from WA_SECRETS_KEY (base64 or 64 hex characters), or null when unset or malformed. */
function loadKey(): Buffer | null {
  const raw = process.env.WA_SECRETS_KEY?.trim();
  if (!raw) return null;
  const key = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  return key.length === 32 ? key : null;
}

export const isEncrypted = (value: string | null | undefined): boolean => !!value?.startsWith(PREFIX);

export function secretsKeyConfigured(): boolean {
  return loadKey() !== null;
}

/**
 * Encrypt a value for storage. Without a key it refuses in production; elsewhere it stores the value
 * as is so local development works without extra setup.
 */
export function encryptSecret(plain: string): string {
  const key = loadKey();
  if (!key) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("WA_SECRETS_KEY is not set (or is not 32 bytes), so credentials cannot be stored safely.");
    }
    return plain;
  }
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return PREFIX + [iv, cipher.getAuthTag(), ct].map((b) => b.toString("base64url")).join(":");
}

/** The original value. Legacy plaintext passes through. Throws if the key is missing or wrong. */
export function decryptSecret(stored: string): string {
  if (!stored.startsWith(PREFIX)) return stored;
  const key = loadKey();
  if (!key) throw new Error("A stored credential is encrypted but WA_SECRETS_KEY is not set.");
  const [iv, tag, ct] = stored.slice(PREFIX.length).split(":").map((p) => Buffer.from(p, "base64url"));
  if (!iv || !tag || !ct) throw new Error("Malformed encrypted credential.");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

/**
 * Read a stored credential for use. Returns null when there is none or it cannot be decrypted, and
 * logs why: a business with an unreadable token then behaves as "not connected", not as a crash.
 */
export function readSecret(stored: string | null | undefined, label = "credential"): string | null {
  if (!stored) return null;
  try {
    return decryptSecret(stored);
  } catch (err) {
    console.error(`Could not read the stored ${label}:`, err instanceof Error ? err.message : err);
    return null;
  }
}
