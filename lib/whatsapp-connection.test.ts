import { describe, expect, it, vi } from "vitest";
import { checkPhoneNumberAccess } from "@/lib/whatsapp-connection";

const reply = (status: number, body: unknown = {}) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe("checkPhoneNumberAccess", () => {
  it("accepts a number the token can see", async () => {
    const f = reply(200, { id: "123456789012345" });
    expect(await checkPhoneNumberAccess("123456789012345", "tok", f)).toEqual({ ok: true });
    const [url, init] = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/123456789012345?");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer tok");
  });

  it("rejects an ID the token cannot access", async () => {
    const r = await checkPhoneNumberAccess("123456789012345", "tok", reply(400, { error: {} }));
    expect(r.ok).toBe(false);
  });

  it("rejects when WhatsApp answers about a different number", async () => {
    const r = await checkPhoneNumberAccess("123456789012345", "tok", reply(200, { id: "999999999" }));
    expect(r.ok).toBe(false);
  });

  it("fails closed when WhatsApp is down or unreachable", async () => {
    expect((await checkPhoneNumberAccess("123456789012345", "tok", reply(503))).ok).toBe(false);
    const boom = vi.fn(async () => {
      throw new Error("network");
    }) as unknown as typeof fetch;
    expect((await checkPhoneNumberAccess("123456789012345", "tok", boom)).ok).toBe(false);
  });

  it("rejects an ID that is not digits without calling WhatsApp", async () => {
    const f = reply(200);
    expect((await checkPhoneNumberAccess("not-a-number", "tok", f)).ok).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });
});
