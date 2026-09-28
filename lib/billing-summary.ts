import { isSubscriptionActive, trialDaysLeft, type SubscriptionInfo } from "@/lib/subscriptions";

export const TRIAL_DAYS = 14;

export type PlanKind = "none" | "trial" | "trial_ended" | "active" | "past_due" | "canceled" | "incomplete";

export interface PlanSummary {
  kind: PlanKind;
  title: string;
  detail: string;
  /** Whether the assistant is currently allowed to reply. */
  assistantOn: boolean;
  /** Trial only: days used out of TRIAL_DAYS, for the progress bar. */
  trialUsed?: number;
  trialLeft?: number;
  /** Paying only: when the current period ends (the next renewal). */
  renewsOn?: string;
}

const dateFmt = new Intl.DateTimeFormat("en-MY", { day: "numeric", month: "long", year: "numeric" });
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Everything the billing page needs to say about a subscription, decided in one place. */
export function summarisePlan(sub: SubscriptionInfo | null | undefined): PlanSummary {
  if (!sub) {
    return {
      kind: "none",
      title: "No plan yet",
      detail: "Subscribe to let the assistant answer your customers.",
      assistantOn: false,
    };
  }

  switch (sub.status) {
    case "active":
      return {
        kind: "active",
        title: "You're subscribed",
        detail: sub.current_period_end
          ? `The assistant is on. Your plan renews on ${dateFmt.format(new Date(sub.current_period_end))}.`
          : "The assistant is on.",
        assistantOn: true,
        renewsOn: sub.current_period_end ?? undefined,
      };

    case "trialing": {
      if (!isSubscriptionActive(sub)) {
        return {
          kind: "trial_ended",
          title: "Your free trial has ended",
          detail: "The assistant is paused. Subscribe to turn it back on.",
          assistantOn: false,
          trialUsed: TRIAL_DAYS,
          trialLeft: 0,
        };
      }
      const left = trialDaysLeft(sub);
      if (left === null) {
        return { kind: "trial", title: "Free trial", detail: "The assistant is on for your free trial.", assistantOn: true };
      }
      return {
        kind: "trial",
        title: "Free trial",
        detail: `The assistant is on. ${plural(left, "day")} left (ends ${dateFmt.format(new Date(sub.trial_ends_at!))}).`,
        assistantOn: true,
        trialUsed: Math.min(TRIAL_DAYS, Math.max(0, TRIAL_DAYS - left)),
        trialLeft: left,
      };
    }

    case "past_due":
      return {
        kind: "past_due",
        title: "Your last payment didn't go through",
        detail: "The assistant is paused. Update your card and it turns back on by itself.",
        assistantOn: false,
      };

    case "canceled":
      return {
        kind: "canceled",
        title: "Your subscription was cancelled",
        detail: "The assistant is paused. Subscribe again any time to turn it back on.",
        assistantOn: false,
      };

    default:
      return {
        kind: "incomplete",
        title: "Checkout wasn't finished",
        detail: "You haven't been charged. Subscribe to turn the assistant on.",
        assistantOn: false,
      };
  }
}
