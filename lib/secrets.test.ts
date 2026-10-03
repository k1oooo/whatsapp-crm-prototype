import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decryptSecret, encryptSecret, isEncrypted, readSecret, secretsKeyConfigured } from "@/lib/secrets";

const KEY = Buffer.alloc(32, 7).toString("base64");

beforeEach(() => {
  process.env.WA_SECRETS_KEY = KEY;
});
afterEach(() => {
  delete process.env.WA_SECRETS_KEY;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("encryptSecret / decryptSecret", () => {
  it("round trips and never stores the plaintext", () => {
    const stored = encryptSecret("EAAG-live-token");
    expect(isEncrypted(stored)).toBe(true);
    expect(stored).not.toContain("EAAG");
    expect(decryptSecret(stored)).toBe("EAAG-live-token");
  });

  it("uses a fresh IV, so the same value never encrypts the same way twice", () => {
    expect(encryptSecret("x")).not.toBe(encryptSecret("x"));
  });

  it("accepts the key as 64 hex characters", () => {
    process.env.WA_SECRETS_KEY = "ab".repeat(32);
    expect(decryptSecret(encryptSecret("hello"))).toBe("hello");
  });

  it("rejects a tampered value", () => {
    const stored = encryptSecret("secret");
    const parts = stored.split(":");
    parts[4] = Buffer.from("tampered").toString("base64url");
    expect(() => decryptSecret(parts.join(":"))).toThrow();
  });

  it("cannot be read with a different key", () => {
    const stored = encryptSecret("secret");
    process.env.WA_SECRETS_KEY = Buffer.alloc(32, 9).toString("base64");
    expect(() => decryptSecret(stored)).toThrow();
  });

  it("passes legacy plaintext through unchanged", () => {
    expect(decryptSecret("plain-old-token")).toBe("plain-old-token");
  });

  it("refuses to store in production without a key, and stores plainly in development", () => {
    delete process.env.WA_SECRETS_KEY;
    vi.stubEnv("NODE_ENV", "production");
    expect(() => encryptSecret("x")).toThrow(/WA_SECRETS_KEY/);
    vi.stubEnv("NODE_ENV", "development");
    expect(encryptSecret("x")).toBe("x");
  });

  it("treats a key of the wrong length as not configured", () => {
    process.env.WA_SECRETS_KEY = "too-short";
    expect(secretsKeyConfigured()).toBe(false);
  });
});

describe("readSecret", () => {
  it("returns null for nothing and for an unreadable value, and logs the latter", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(readSecret(null)).toBeNull();
    expect(readSecret(undefined)).toBeNull();
    const stored = encryptSecret("s");
    delete process.env.WA_SECRETS_KEY;
    expect(readSecret(stored, "access token")).toBeNull();
    expect(log).toHaveBeenCalled();
  });

  it("returns the value when it can be read", () => {
    expect(readSecret(encryptSecret("s"))).toBe("s");
    expect(readSecret("plain")).toBe("plain");
  });
});
