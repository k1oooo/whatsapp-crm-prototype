import { describe, expect, it } from "vitest";
import { isFacebookOrigin, parseSessionEvent } from "@/lib/embedded-signup-client";

describe("isFacebookOrigin", () => {
  it("accepts facebook.com and its subdomains over https", () => {
    expect(isFacebookOrigin("https://www.facebook.com")).toBe(true);
    expect(isFacebookOrigin("https://web.facebook.com")).toBe(true);
    expect(isFacebookOrigin("https://facebook.com")).toBe(true);
  });
  it("rejects lookalike and non-https origins", () => {
    expect(isFacebookOrigin("https://evilfacebook.com")).toBe(false);
    expect(isFacebookOrigin("https://facebook.com.evil.example")).toBe(false);
    expect(isFacebookOrigin("http://www.facebook.com")).toBe(false);
    expect(isFacebookOrigin("not a url")).toBe(false);
  });
});

describe("parseSessionEvent", () => {
  const finish = { type: "WA_EMBEDDED_SIGNUP", event: "FINISH", data: { phone_number_id: "111111", waba_id: "222222", business_id: "3" } };

  it("reads a finished sign-up, sent as a JSON string or an object", () => {
    const want = { kind: "finish", wabaId: "222222", phoneNumberId: "111111" };
    expect(parseSessionEvent(JSON.stringify(finish))).toEqual(want);
    expect(parseSessionEvent(finish)).toEqual(want);
  });
  it("treats a finish without both IDs as unsupported", () => {
    expect(parseSessionEvent({ ...finish, data: { waba_id: "222222" } })).toEqual({ kind: "unsupported", event: "FINISH" });
  });
  it("reads a cancel and a reported error", () => {
    expect(parseSessionEvent({ type: "WA_EMBEDDED_SIGNUP", event: "CANCEL", data: { current_step: "PHONE_NUMBER_SETUP" } })).toEqual({
      kind: "cancel",
      step: "PHONE_NUMBER_SETUP",
      errorMessage: undefined,
    });
    expect(parseSessionEvent({ type: "WA_EMBEDDED_SIGNUP", event: "CANCEL", data: { error_message: "Bad name", error_code: "1" } })).toMatchObject({
      kind: "cancel",
      errorMessage: "Bad name",
    });
  });
  it("marks sign-up types it does not handle yet", () => {
    expect(parseSessionEvent({ type: "WA_EMBEDDED_SIGNUP", event: "FINISH_ONLY_WABA", data: {} })).toEqual({
      kind: "unsupported",
      event: "FINISH_ONLY_WABA",
    });
  });
  it("ignores everything that is not an Embedded Signup event", () => {
    expect(parseSessionEvent("not json")).toBeNull();
    expect(parseSessionEvent({ type: "OTHER", event: "FINISH" })).toBeNull();
    expect(parseSessionEvent(null)).toBeNull();
    expect(parseSessionEvent(42)).toBeNull();
  });
});
