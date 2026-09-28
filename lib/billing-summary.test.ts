import { describe, expect, it } from "vitest";
import { summarisePlan, TRIAL_DAYS } from "@/lib/billing-summary";
import type { SubscriptionInfo } from "@/lib/subscriptions";

const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();
const sub = (status: SubscriptionInfo["status"], trial: string | null = null, period: string | null = null): SubscriptionInfo => ({
  status,
  trial_ends_at: trial,
  current_period_end: period,
});

describe("summarisePlan", () => {
  it("reports a running trial with days used and left", () => {
    const s = summarisePlan(sub("trialing", inDays(4)));
    expect(s.kind).toBe("trial");
    expect(s.assistantOn).toBe(true);
    expect(s.trialLeft).toBe(4);
    expect(s.trialUsed).toBe(TRIAL_DAYS - 4);
    expect(s.detail).toMatch(/4 days left/);
  });

  it("says '1 day', not '1 days'", () => {
    expect(summarisePlan(sub("trialing", inDays(1))).detail).toMatch(/1 day left/);
  });

  it("never reports more than a full trial used, even for an odd trial length", () => {
    expect(summarisePlan(sub("trialing", inDays(40))).trialUsed).toBe(0);
  });

  it("treats an expired trial as ended and the assistant as off", () => {
    const s = summarisePlan(sub("trialing", inDays(-2)));
    expect(s.kind).toBe("trial_ended");
    expect(s.assistantOn).toBe(false);
    expect(s.trialUsed).toBe(TRIAL_DAYS);
  });

  it("reports a paying customer with the renewal date", () => {
    const s = summarisePlan(sub("active", null, inDays(20)));
    expect(s.kind).toBe("active");
    expect(s.assistantOn).toBe(true);
    expect(s.renewsOn).toBeTruthy();
    expect(s.detail).toMatch(/renews on/);
  });

  it("copes with a paying customer whose period end is not known yet", () => {
    expect(summarisePlan(sub("active")).detail).toBe("The assistant is on.");
  });

  it.each([
    ["past_due", "past_due"],
    ["canceled", "canceled"],
    ["incomplete", "incomplete"],
  ] as const)("marks %s as off", (status, kind) => {
    const s = summarisePlan(sub(status));
    expect(s.kind).toBe(kind);
    expect(s.assistantOn).toBe(false);
  });

  it("handles no subscription at all", () => {
    expect(summarisePlan(null).kind).toBe("none");
    expect(summarisePlan(null).assistantOn).toBe(false);
  });

  it("agrees with the rule the webhook gate uses", () => {
    // If this page says the assistant is on, the gate in whatsapp.ts must agree, and vice versa.
    for (const s of [sub("active"), sub("trialing", inDays(3)), sub("trialing", inDays(-1)), sub("past_due"), sub("canceled")]) {
      const gate = s.status === "active" || (s.status === "trialing" && new Date(s.trial_ends_at!) > new Date());
      expect(summarisePlan(s).assistantOn).toBe(gate);
    }
  });
});
