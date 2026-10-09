import { describe, expect, it } from "vitest";
import nextConfig from "./next.config";

describe("security headers", () => {
  it("are sent on every route and block framing", async () => {
    const rules = await nextConfig.headers!();
    expect(rules).toHaveLength(1);
    expect(rules[0].source).toBe("/:path*");
    const h = Object.fromEntries(rules[0].headers.map((x) => [x.key, x.value]));
    expect(h["X-Frame-Options"]).toBe("DENY");
    expect(h["Content-Security-Policy"]).toContain("frame-ancestors 'none'");
    expect(h["X-Content-Type-Options"]).toBe("nosniff");
    expect(h["Referrer-Policy"]).toBeTruthy();
    expect(h["Strict-Transport-Security"]).toMatch(/max-age=\d+/);
  });
});
