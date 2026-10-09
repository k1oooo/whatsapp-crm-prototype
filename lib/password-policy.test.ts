import { describe, expect, it } from "vitest";
import { passwordProblem } from "@/lib/password-policy";

describe("passwordProblem", () => {
  it("accepts 8 to 72 characters", () => {
    expect(passwordProblem("12345678")).toBeNull();
    expect(passwordProblem("a".repeat(72))).toBeNull();
  });
  it("rejects short and overlong passwords", () => {
    expect(passwordProblem("1234567")).toMatch(/at least 8/);
    expect(passwordProblem("a".repeat(73))).toMatch(/72/);
  });
});
