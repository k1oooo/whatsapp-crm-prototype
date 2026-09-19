// lib/ai.ts
// Lead extraction (cheap, runs on every new message) and follow-up drafts (runs on cold leads).
// If ANTHROPIC_API_KEY is not set, both functions run in mock mode so you can build for free.

import Anthropic from "@anthropic-ai/sdk";

const EXTRACT_MODEL = "claude-haiku-4-5-20251001";
const DRAFT_MODEL = "claude-sonnet-5";

let _client: Anthropic | null = null;
function getClient(): Anthropic | null {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!_client) _client = new Anthropic();
  return _client;
}

export type Stage = "new" | "talking" | "quoted" | "won" | "lost";

export interface ChatMessage {
  direction: "in" | "out";
  body: string;
  sentAt: string; // ISO string
}

export interface LeadFields {
  name: string | null;
  need: string | null;
  budget_myr: number | null;
  deadline: string | null; // YYYY-MM-DD
  stage: Stage;
  language: string | null; // "en" | "bm" | "manglish"
}

function transcript(messages: ChatMessage[]): string {
  return messages
    .map((m) => `[${m.sentAt}] ${m.direction === "in" ? "CUSTOMER" : "OWNER"}: ${m.body}`)
    .join("\n");
}

const EXTRACT_SYSTEM = `You read a WhatsApp chat between a Malaysian small business owner (OWNER) and a potential customer (CUSTOMER). Chats mix English, Bahasa Malaysia and Manglish.

Return ONLY a JSON object, no other text, with exactly these keys:
name (string or null), need (short phrase or null), budget_myr (integer in RM or null), deadline (YYYY-MM-DD or null), stage, language.

Rules:
- Only use what is stated in the chat. Use null when unknown. Never guess.
- Resolve relative dates ("28 Sept", "next Friday") using the message timestamps. Assume the next occurrence.
- stage is one of: new (customer just asked, owner has not really engaged), talking (details being discussed), quoted (owner gave a price), won (customer confirmed or paid), lost (customer declined or went elsewhere).
- "I'll confirm later" means the stage stays talking or quoted, not won.
- language is the customer's main style: en, bm, or manglish.`;

export async function extractLead(messages: ChatMessage[]): Promise<LeadFields> {
  const client = getClient();

  if (!client) {
    // Mock mode: no API cost. Enough to exercise the pipeline and UI.
    const hasOutbound = messages.some((m) => m.direction === "out");
    return {
      name: null,
      need: "Sample need (mock mode)",
      budget_myr: null,
      deadline: null,
      stage: hasOutbound ? "talking" : "new",
      language: "manglish",
    };
  }

  const res = await client.messages.create({
    model: EXTRACT_MODEL,
    max_tokens: 400,
    system: EXTRACT_SYSTEM,
    messages: [{ role: "user", content: transcript(messages) }],
  });

  const text = res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  const clean = text.replace(/```json|```/g, "").trim();
  return JSON.parse(clean) as LeadFields;
}

/**
 * Merge a new extraction into the existing lead.
 * Only overwrite a field when the new value is not null, so one vague message
 * cannot erase details we already know.
 */
export function mergeLead(existing: Partial<LeadFields>, next: LeadFields): LeadFields {
  return {
    name: next.name ?? existing.name ?? null,
    need: next.need ?? existing.need ?? null,
    budget_myr: next.budget_myr ?? existing.budget_myr ?? null,
    deadline: next.deadline ?? existing.deadline ?? null,
    stage: next.stage,
    language: next.language ?? existing.language ?? null,
  };
}

export async function draftFollowUp(args: {
  lead: LeadFields;
  messages: ChatMessage[];
  daysQuiet: number;
  toneNotes?: string | null;
}): Promise<string> {
  const { lead, messages, daysQuiet, toneNotes } = args;
  const client = getClient();

  if (!client) {
    return `Hi! Just checking in${lead.need ? ` about ${lead.need}` : ""}. Boleh confirm ya? (mock draft)`;
  }

  const system = `You write WhatsApp follow-up messages for a Malaysian small business owner, in the owner's voice.
Match the customer's language (English, BM or Manglish) and the owner's tone from the OWNER lines in the chat.
${toneNotes ? `Owner tone notes: ${toneNotes}` : ""}

Rules:
- 1 to 3 short sentences. Sounds like a person, not a marketer.
- Mention the specific need and the deadline if known.
- Give one clear next step, such as confirming by a day.
- Do not invent discounts, prices or slot numbers that are not in the chat.
- Do not use em dashes.
- Return only the message text.`;

  const user = `Lead: ${JSON.stringify(lead)}
Days quiet: ${daysQuiet}

Chat:
${transcript(messages)}`;

  const res = await client.messages.create({
    model: DRAFT_MODEL,
    max_tokens: 300,
    system,
    messages: [{ role: "user", content: user }],
  });

  return res.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
}
