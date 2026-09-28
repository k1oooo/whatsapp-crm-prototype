import { describe, expect, it } from "vitest";
import { isSubscriptionActive, subscriptionBlockedNote, trialDaysLeft, type SubscriptionInfo } from "@/lib/subscriptions";

const days = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();
const sub = (status: SubscriptionInfo["status"], trial_ends_at: string | null = null): SubscriptionInfo => ({
  status,
  trial_ends_at,
  current_period_end: null,
});

describe("isSubscriptionActive", () => {
  it("is active while paid", () => {
    expect(isSubscriptionActive(sub("active"))).toBe(true);
  });

  it("is active during an unexpired trial", () => {
    expect(isSubscriptionActive(sub("trialing", days(3)))).toBe(true);
  });

  it("is blocked once a trial that never converted has expired, even though status still says trialing", () => {
    expect(isSubscriptionActive(sub("trialing", days(-1)))).toBe(false);
  });

  it("does not treat a trial with no end date as expired", () => {
    expect(isSubscriptionActive(sub("trialing", null))).toBe(true);
  });

  it.each(["past_due", "canceled", "incomplete"] as const)("is blocked when %s", (status) => {
    expect(isSubscriptionActive(sub(status))).toBe(false);
  });

  it("is blocked when there is no subscription at all", () => {
    expect(isSubscriptionActive(null)).toBe(false);
    expect(isSubscriptionActive(undefined)).toBe(false);
  });
});

describe("subscriptionBlockedNote", () => {
  it("explains an ended trial", () => {
    expect(subscriptionBlockedNote(sub("trialing", days(-1)))).toMatch(/trial has ended/i);
  });
  it("explains a failed payment", () => {
    expect(subscriptionBlockedNote(sub("past_due"))).toMatch(/payment did not go through/i);
  });
  it("has a generic message for anything else", () => {
    expect(subscriptionBlockedNote(sub("canceled"))).toMatch(/not active/i);
  });
});

describe("trialDaysLeft", () => {
  it("counts whole days remaining, rounding a partial day up", () => {
    expect(trialDaysLeft(sub("trialing", days(3)))).toBe(3);
    expect(trialDaysLeft(sub("trialing", new Date(Date.now() + 3_600_000).toISOString()))).toBe(1);
  });
  it("is null for an expired trial, a paid subscription, or nothing", () => {
    expect(trialDaysLeft(sub("trialing", days(-1)))).toBeNull();
    expect(trialDaysLeft(sub("active"))).toBeNull();
    expect(trialDaysLeft(null)).toBeNull();
  });
});
