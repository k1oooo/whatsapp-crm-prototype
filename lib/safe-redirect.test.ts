import { describe, expect, it } from "vitest";
import { safeNextPath } from "@/lib/safe-redirect";

describe("safeNextPath", () => {
  it("keeps same-site paths, with query and hash", () => {
    expect(safeNextPath("/dashboard")).toBe("/dashboard");
    expect(safeNextPath("/login/reset-password?x=1#top")).toBe("/login/reset-password?x=1#top");
  });

  it("falls back when there is no value", () => {
    expect(safeNextPath(null)).toBe("/dashboard");
    expect(safeNextPath("")).toBe("/dashboard");
    expect(safeNextPath(undefined, "/x")).toBe("/x");
  });

  it("REGRESSION: refuses values that leave the site", () => {
    for (const bad of [
      "@evil.example",
      ".evil.example",
      "evil.example",
      "https://evil.example",
      "//evil.example",
      "/\\evil.example",
      "\\\\evil.example",
      "/\t/evil.example",
      "/%2F%2Fevil.example/../..//evil.example".replace("%2F", "\n"),
      "javascript:alert(1)",
    ]) {
      expect(safeNextPath(bad), bad).toBe("/dashboard");
    }
  });
});
