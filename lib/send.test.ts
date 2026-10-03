import { afterEach, describe, expect, it, vi } from "vitest";
import { encryptSecret } from "@/lib/secrets";
import { resolveToken, sendMode, sendWhatsAppText } from "@/lib/send";

const KEY = Buffer.alloc(32, 4).toString("base64");

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  delete process.env.WA_SECRETS_KEY;
  delete process.env.WHATSAPP_SEND_MODE;
  delete process.env.WHATSAPP_ACCESS_TOKEN;
});

describe("sending with stored credentials", () => {
  it("decrypts the business's own token and sends with it", async () => {
    process.env.WA_SECRETS_KEY = KEY;
    process.env.WHATSAPP_SEND_MODE = "live";
    process.env.WHATSAPP_ACCESS_TOKEN = "shared-token";
    const f = vi.fn(async () => new Response(JSON.stringify({ messages: [{ id: "wamid.1" }] }), { status: 200 }));
    vi.stubGlobal("fetch", f);

    const r = await sendWhatsAppText("111", "6012", "hi", encryptSecret("own-token"));
    expect(r).toEqual({ id: "wamid.1", dry: false });
    const init = (f.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer own-token");
  });

  it("never falls back to the shared token when the business's own token cannot be read", async () => {
    process.env.WA_SECRETS_KEY = KEY;
    const stored = encryptSecret("own-token");
    delete process.env.WA_SECRETS_KEY;
    process.env.WHATSAPP_SEND_MODE = "live";
    process.env.WHATSAPP_ACCESS_TOKEN = "shared-token";
    vi.spyOn(console, "error").mockImplementation(() => {});
    const f = vi.fn();
    vi.stubGlobal("fetch", f);

    expect(resolveToken(stored)).toBeUndefined();
    await expect(sendWhatsAppText("111", "6012", "hi", stored)).rejects.toThrow(/could not be read/);
    expect(f).not.toHaveBeenCalled();
  });

  it("uses the shared token for a business with none of its own", () => {
    process.env.WHATSAPP_SEND_MODE = "live";
    process.env.WHATSAPP_ACCESS_TOKEN = "shared-token";
    expect(resolveToken(null)).toBe("shared-token");
    expect(sendMode(null)).toBe("live");
  });

  it("retries a 429 but not a 500, so a customer is never messaged twice by a retry", async () => {
    process.env.WHATSAPP_SEND_MODE = "live";
    process.env.WHATSAPP_ACCESS_TOKEN = "t";
    const f500 = vi.fn(async () => new Response("{}", { status: 500 }));
    vi.stubGlobal("fetch", f500);
    await expect(sendWhatsAppText("111", "6012", "hi")).rejects.toThrow(/500/);
    expect(f500).toHaveBeenCalledTimes(1);
  });
});
