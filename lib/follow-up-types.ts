import type { FollowUpKind } from "@/lib/follow-up-settings";

export interface FollowUpLead {
  id: string;
  name: string | null;
  wa_contact_number: string;
  follow_up_consent: "unknown" | "yes" | "no";
}

export interface QueueItem {
  id: string;
  kind: FollowUpKind;
  status: "scheduled" | "sending" | "sent" | "skipped" | "failed";
  due_at: string;
  sent_at: string | null;
  detail: string | null;
  campaign: string | null;
  lead: FollowUpLead | null;
}

export interface FeedbackItem {
  id: string;
  rating: number | null;
  comment: string | null;
  created_at: string;
  lead: { id: string; name: string | null; wa_contact_number: string } | null;
}
