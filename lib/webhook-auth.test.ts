import { beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_PHONE_NUMBER_IDS, phoneNumberIdsOf, verifyWebhook } from "@/lib/webhook-auth";
import type { WaWebhookPayload } from "@/lib/whatsapp";
import { createFakeSupabase, type FakeDb } from "@/test/fake-supabase";
import { signPayload } from "@/test/webhook-fixtures";

const SHARED = "shared-app-secret";
const SECRET_A = "secret-of-business-a";
const SECRET_B = "secret-of-business-b";

function change(phoneNumberId: string) {
  return {
    field: "messages",
    value: {
      metadata: { phone_number_id: phoneNumberId },
      contacts: [{ wa_id: "60123456789", profile: { name: "X" } }],
      messages: [{ from: "60123456789", id: `wamid.${phoneNumberId}`, timestamp: "1", type: "text", text: { body: "hi" } }],
    },
  };
}
const payloadFor = (...ids: string[]): WaWebhookPayload => ({ object: "whatsapp_business_account", entry: [{ id: "W", changes: ids.map(change) }] });

function dbWith(businesses: Record<string, unknown>[]) {
  return createFakeSupabase({ businesses } as FakeDb);
}
async function check(db: ReturnType<typeof dbWith>, payload: WaWebhookPayload, secret: string) {
  const raw = JSON.stringify(payload);
  return verifyWebhook(db, raw, signPayload(raw, secret), payload);
}

beforeEach(() => {
  process.env.WHATSAPP_APP_SECRET = SHARED;
});

const bizA = { id: "a", owner_id: "oa", wa_phone_number_id: "1111111", wa_app_secret: SECRET_A, wa_access_token: "ta" };
const bizB = { id: "b", owner_id: "ob", wa_phone_number_id: "2222222", wa_app_secret: SECRET_B, wa_access_token: "tb" };

describe("a business connected through Embedded Signup", () => {
  // It holds a token of its own but no app secret: its number belongs to the deployment's Meta app.
  const embedded = { id: "e", owner_id: "oe", wa_phone_number_id: "3333333", wa_access_token: "te", wa_connection_type: "embedded" };

  it("is verified with the deployment's shared secret", async () => {
    expect(await check(dbWith([embedded]), payloadFor("3333333"), SHARED)).toBe(true);
  });
  it("is not verified with some other secret", async () => {
    expect(await check(dbWith([embedded]), payloadFor("3333333"), SECRET_A)).toBe(false);
  });
  it("still fails closed when the deployment has no shared secret", async () => {
    delete process.env.WHATSAPP_APP_SECRET;
    expect(await check(dbWith([embedded]), payloadFor("3333333"), SHARED)).toBe(false);
  });
  it("does not let a bring-your-own-app business ride on the shared secret", async () => {
    const own = { id: "m", owner_id: "om", wa_phone_number_id: "4444444", wa_access_token: "tm", wa_connection_type: "manual" };
    expect(await check(dbWith([own]), payloadFor("4444444"), SHARED)).toBe(false);
  });
});

describe("phoneNumberIdsOf", () => {
  it("collects every distinct id across entries and changes", () => {
    const p: WaWebhookPayload = {
      entry: [
        { id: "1", changes: [change("A"), change("B")] },
        { id: "2", changes: [change("A")] },
      ],
    };
    expect(phoneNumberIdsOf(p).sort()).toEqual(["A", "B"]);
  });
  it("returns nothing for an empty payload", () => {
    expect(phoneNumberIdsOf({})).toEqual([]);
  });
});

describe("verifyWebhook", () => {
  it("accepts a delivery signed with the business's own secret", async () => {
    expect(await check(dbWith([bizA, bizB]), payloadFor("1111111"), SECRET_A)).toBe(true);
  });

  it("rejects a delivery signed with the wrong secret", async () => {
    expect(await check(dbWith([bizA, bizB]), payloadFor("1111111"), SECRET_B)).toBe(false);
  });

  it("REGRESSION: rejects a payload that signs for its own number but also targets another tenant's", async () => {
    // Tenant A signs with A's secret. The first change is A's own number; the second names B's number.
    // Before the fix only the first change was checked, so B's number got a forged inbound message.
    const forged = payloadFor("1111111", "2222222");
    expect(await check(dbWith([bizA, bizB]), forged, SECRET_A)).toBe(false);
  });

  it("rejects the same forgery when the victim's change comes first", async () => {
    expect(await check(dbWith([bizA, bizB]), payloadFor("2222222", "1111111"), SECRET_A)).toBe(false);
  });

  it("accepts several numbers when they all use the same shared secret", async () => {
    const shared1 = { id: "c", owner_id: "oc", wa_phone_number_id: "3333333" };
    const shared2 = { id: "d", owner_id: "od", wa_phone_number_id: "4444444" };
    expect(await check(dbWith([shared1, shared2]), payloadFor("3333333", "4444444"), SHARED)).toBe(true);
  });

  it("uses the shared secret for a business with no credentials of its own", async () => {
    const plain = { id: "c", owner_id: "oc", wa_phone_number_id: "3333333" };
    expect(await check(dbWith([plain]), payloadFor("3333333"), SHARED)).toBe(true);
  });

  it("does not fall back to the shared secret for a business that brought its own token but no app secret", async () => {
    const half = { id: "e", owner_id: "oe", wa_phone_number_id: "5555555", wa_access_token: "own-token", wa_app_secret: null };
    expect(await check(dbWith([half]), payloadFor("5555555"), SHARED)).toBe(false);
  });

  it("does not let a business that has its own secret be verified with the shared one", async () => {
    expect(await check(dbWith([bizA]), payloadFor("1111111"), SHARED)).toBe(false);
  });

  it("still requires a genuine shared-secret signature for a number nobody has registered", async () => {
    expect(await check(dbWith([bizA]), payloadFor("9999999"), SHARED)).toBe(true);
    expect(await check(dbWith([bizA]), payloadFor("9999999"), SECRET_A)).toBe(false);
  });

  it("rejects a payload that lists more phone numbers than a real delivery would", async () => {
    const ids = Array.from({ length: MAX_PHONE_NUMBER_IDS + 1 }, (_, i) => String(7000000 + i));
    expect(await check(dbWith([]), payloadFor(...ids), SHARED)).toBe(false);
  });

  it("rejects a missing signature header and a missing shared secret", async () => {
    const p = payloadFor("1111111");
    expect(await verifyWebhook(dbWith([bizA]), JSON.stringify(p), null, p)).toBe(false);
    delete process.env.WHATSAPP_APP_SECRET;
    expect(await check(dbWith([]), payloadFor("9999999"), SHARED)).toBe(false);
  });

  it("fails closed when the secret lookup errors", async () => {
    const db = dbWith([bizA]);
    const real = db.from.bind(db);
    (db as unknown as { from: unknown }).from = (t: string) => {
      const b = real(t) as unknown as Record<string, unknown>;
      b.maybeSingle = async () => ({ data: null, error: { message: "boom" } });
      return b;
    };
    expect(await check(db, payloadFor("1111111"), SHARED)).toBe(false);
  });
});

describe("verifyWebhook with encrypted credentials", () => {
  const KEY = Buffer.alloc(32, 3).toString("base64");
  const withKey = async (fn: () => Promise<void>) => {
    process.env.WA_SECRETS_KEY = KEY;
    try {
      await fn();
    } finally {
      delete process.env.WA_SECRETS_KEY;
    }
  };

  it("verifies against a secret that is stored encrypted", () =>
    withKey(async () => {
      const { encryptSecret } = await import("@/lib/secrets");
      const biz = { ...bizA, wa_app_secret: encryptSecret(SECRET_A), wa_access_token: encryptSecret("tok") };
      expect(await check(dbWith([biz]), payloadFor("1111111"), SECRET_A)).toBe(true);
      expect(await check(dbWith([biz]), payloadFor("1111111"), SHARED)).toBe(false);
    }));

  it("fails closed when the stored secret cannot be decrypted, instead of using the shared one", () =>
    withKey(async () => {
      const { encryptSecret } = await import("@/lib/secrets");
      const stored = encryptSecret(SECRET_A);
      delete process.env.WA_SECRETS_KEY; // key lost
      vi.spyOn(console, "error").mockImplementation(() => {});
      const biz = { ...bizA, wa_app_secret: stored };
      expect(await check(dbWith([biz]), payloadFor("1111111"), SECRET_A)).toBe(false);
      expect(await check(dbWith([biz]), payloadFor("1111111"), SHARED)).toBe(false);
    }));
});
