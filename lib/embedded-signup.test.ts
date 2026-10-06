import { afterEach, describe, expect, it, vi } from "vitest";
import {
  embeddedSignupConfig,
  exchangeCodeForToken,
  generatePin,
  registerPhoneNumber,
  subscribeAppToWaba,
  type EmbeddedConfig,
} from "@/lib/embedded-signup";

const cfg: EmbeddedConfig = { appId: "app-1", appSecret: "app-secret", configId: "cfg-1", version: "v25.0" };
const reply = (status: number, body: unknown = {}) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
const callOf = (f: typeof fetch) => (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];

afterEach(() => {
  delete process.env.NEXT_PUBLIC_META_APP_ID;
  delete process.env.NEXT_PUBLIC_META_ES_CONFIG_ID;
  delete process.env.WHATSAPP_APP_SECRET;
  delete process.env.WHATSAPP_API_VERSION;
});

describe("embeddedSignupConfig", () => {
  it("needs the app ID, the configuration ID and the app secret", () => {
    expect(embeddedSignupConfig()).toBeNull();
    process.env.NEXT_PUBLIC_META_APP_ID = "app-1";
    process.env.NEXT_PUBLIC_META_ES_CONFIG_ID = "cfg-1";
    expect(embeddedSignupConfig()).toBeNull();
    process.env.WHATSAPP_APP_SECRET = "app-secret";
    process.env.WHATSAPP_API_VERSION = "v25.0";
    expect(embeddedSignupConfig()).toEqual(cfg);
  });
});

describe("generatePin", () => {
  it("is always six digits", () => {
    for (let i = 0; i < 200; i++) expect(generatePin()).toMatch(/^\d{6}$/);
  });
});

describe("exchangeCodeForToken", () => {
  it("sends the code with the app credentials and returns the token", async () => {
    const f = reply(200, { access_token: "biz-token", token_type: "bearer" });
    expect(await exchangeCodeForToken("the-code", cfg, f)).toEqual({ ok: true, token: "biz-token" });
    const url = new URL(callOf(f)[0]);
    expect(url.pathname).toBe("/v25.0/oauth/access_token");
    expect(url.searchParams.get("client_id")).toBe("app-1");
    expect(url.searchParams.get("client_secret")).toBe("app-secret");
    expect(url.searchParams.get("code")).toBe("the-code");
  });
  it("fails when Meta refuses the code, without leaking anything into the error", async () => {
    const r = await exchangeCodeForToken("expired", cfg, reply(400, { error: { code: 100, message: "bad code" } }));
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain("app-secret");
  });
  it("fails when no token comes back or Meta is unreachable", async () => {
    expect((await exchangeCodeForToken("c", cfg, reply(200, {}))).ok).toBe(false);
    const boom = vi.fn(async () => {
      throw new Error("network");
    }) as unknown as typeof fetch;
    expect((await exchangeCodeForToken("c", cfg, boom)).ok).toBe(false);
  });
});

describe("subscribeAppToWaba and registerPhoneNumber", () => {
  it("subscribes the app to the business's account with its own token", async () => {
    const f = reply(200, { success: true });
    expect(await subscribeAppToWaba("222222", "biz-token", f)).toEqual({ ok: true });
    const [url, init] = callOf(f);
    expect(url).toContain("/222222/subscribed_apps");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer biz-token");
  });
  it("registers the number with the given PIN", async () => {
    const f = reply(200, { success: true });
    expect(await registerPhoneNumber("111111", "biz-token", "123456", f)).toEqual({ ok: true });
    const [url, init] = callOf(f);
    expect(url).toContain("/111111/register");
    expect(JSON.parse(String(init.body))).toEqual({ messaging_product: "whatsapp", pin: "123456" });
  });
  it("reports a refusal from Meta", async () => {
    expect((await subscribeAppToWaba("222222", "t", reply(403))).ok).toBe(false);
    expect((await registerPhoneNumber("111111", "t", "123456", reply(400))).ok).toBe(false);
  });
});
