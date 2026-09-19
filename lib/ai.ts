// lib/ai.ts
// Lead extraction (runs on every new message) and follow-up drafts (runs on cold leads).
//
// Provider is picked from environment variables:
//   AI_API_KEY set        -> any OpenAI-compatible API (Gemini free tier, Groq, OpenRouter, ...)
//   ANTHROPIC_API_KEY set -> Claude
//   neither               -> mock mode (fixed sample output, no network)

import Anthropic from "@anthropic-ai/sdk";

// Free-tier default: Google AI Studio through its OpenAI-compatible endpoint.
// Model ids change often, so check AI Studio for the current Flash-Lite id and set AI_MODEL.
const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai";
const DEFAULT_MODEL = "gemini-3.5-flash-lite";

const CLAUDE_EXTRACT_MODEL = "claude-haiku-4-5-20251001";
const CLAUDE_DRAFT_MODEL = "claude-sonnet-5";

export type Stage = "new" | "talking" | "quoted" | "won" | "lost";
const STAGE_VALUES: Stage[] = ["new", "talking", "quoted", "won", "lost"];

export interface ChatMessage {
  direction: "in" | "out";
  body: string;
  sentAt: string; // ISO string
}

export interface LeadFields {
  name: string | null;
  need: string | null;
  budget_myr: number | null; // what the customer said they can spend
  quoted_price_myr: number | null; // the price the owner quoted
  deadline: string | null; // YYYY-MM-DD
  stage: Stage;
  language: string | null; // "en" | "bm" | "manglish"
}

type Provider = "openai-compatible" | "anthropic" | "mock";

function provider(): Provider {
  if (process.env.AI_API_KEY) return "openai-compatible";
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  return "mock";
}

let _anthropic: Anthropic | null = null;

async function complete(kind: "extract" | "draft", system: string, user: string): Promise<string> {
  if (provider() === "openai-compatible") {
    const base = (process.env.AI_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, "");
    const model =
      (kind === "extract" ? process.env.AI_MODEL_EXTRACT : process.env.AI_MODEL_DRAFT) ||
      process.env.AI_MODEL ||
      DEFAULT_MODEL;

    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${process.env.AI_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });

    if (!res.ok) {
      throw new Error(`AI request failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
    }
    const json = await res.json();
    return String(json.choices?.[0]?.message?.content ?? "");
  }

  // Anthropic
  if (!_anthropic) _anthropic = new Anthropic();
  const res = await _anthropic.messages.create({
    model: kind === "extract" ? CLAUDE_EXTRACT_MODEL : CLAUDE_DRAFT_MODEL,
    max_tokens: kind === "extract" ? 400 : 300,
    system,
    messages: [{ role: "user", content: user }],
  });
  return res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
}

function transcript(messages: ChatMessage[]): string {
  return messages
    .map((m) => `[${m.sentAt}] ${m.direction === "in" ? "CUSTOMER" : "OWNER"}: ${m.body}`)
    .join("\n");
}

const EXTRACT_SYSTEM = `You read a WhatsApp chat between a Malaysian small business owner (OWNER) and a potential customer (CUSTOMER). Chats mix English, Bahasa Malaysia and Manglish.

Return ONLY a JSON object, no other text, with exactly these keys:
name (string or null), need (short phrase or null), budget_myr (integer in RM or null), quoted_price_myr (integer in RM or null), deadline (YYYY-MM-DD or null), stage, language.

Rules:
- Only use what is stated in the chat. Use null when unknown. Never guess.
- budget_myr is what the CUSTOMER says they want to spend. quoted_price_myr is the price the OWNER quoted. Keep them separate.
- name is the customer's own name only if they gave it. Never use "kak", "abang", "boss" or similar titles as a name.
- Resolve relative dates ("28 Sept", "next Friday") using the message timestamps. Assume the next occurrence.
- stage is one of: new (customer just asked, owner has not really engaged), talking (details being discussed), quoted (owner gave a price), won (customer confirmed or paid), lost (customer declined or went elsewhere).
- "I'll confirm later" means the stage stays talking or quoted, not won.
- language is the customer's main style: en, bm, or manglish.`;

const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim() : null;

/** Free models sometimes return sloppy JSON. Pull out the object and clean every field. */
function parseLead(text: string): LeadFields {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("No JSON in AI reply");
  const raw = JSON.parse(text.slice(start, end + 1));

  const num = (v: unknown): number | null => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
  };
  const deadline = str(raw.deadline);

  return {
    name: str(raw.name),
    need: str(raw.need),
    budget_myr: num(raw.budget_myr),
    quoted_price_myr: num(raw.quoted_price_myr),
    deadline: deadline && /^\d{4}-\d{2}-\d{2}$/.test(deadline) ? deadline : null,
    stage: STAGE_VALUES.includes(raw.stage) ? raw.stage : "talking",
    language: str(raw.language),
  };
}

export async function extractLead(messages: ChatMessage[]): Promise<LeadFields> {
  if (provider() === "mock") {
    const hasOutbound = messages.some((m) => m.direction === "out");
    return {
      name: null,
      need: "Sample need (mock mode)",
      budget_myr: null,
      quoted_price_myr: null,
      deadline: null,
      stage: hasOutbound ? "talking" : "new",
      language: "manglish",
    };
  }

  const text = await complete("extract", EXTRACT_SYSTEM, transcript(messages));
  return parseLead(text);
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
    quoted_price_myr: next.quoted_price_myr ?? existing.quoted_price_myr ?? null,
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
  awaitingOwnerReply?: boolean;
}): Promise<string> {
  const { lead, messages, daysQuiet, toneNotes, awaitingOwnerReply } = args;

  if (provider() === "mock") {
    return `Hi! Just checking in${lead.need ? ` about ${lead.need}` : ""}. Boleh confirm ya? (mock draft)`;
  }

  const situation = awaitingOwnerReply
    ? `The customer's last message has not been answered yet, so the owner owes them a reply.
Write a short reply to that last message.
- Only answer what the chat supports. If they asked for a discount or anything the owner has not decided, do not agree or refuse. Do not start with words that sound like agreement, such as "boleh", "sure" or "okay". Say you will check and get back to them.
- If it has been more than a day, apologise briefly for the late reply.`
    : `The customer went quiet after the owner's last message, so this is a gentle nudge.
- If a quoted price is in the lead details, remind them of it. Mention the deadline if known.
- Give one clear next step, such as asking them to reply to confirm.`;

  const system = `You write WhatsApp messages for a Malaysian small business owner, in the owner's voice.
Match the customer's language (English, BM or Manglish) and the owner's tone from the OWNER lines in the chat.
${toneNotes ? `Owner tone notes: ${toneNotes}` : ""}

Situation:
${situation}

Rules:
- Write as the owner speaking to the customer. Never call the customer "kak", "abang" or any other title the customer used for the owner.
- Greet by the customer's name only if it is known, otherwise skip the name. Never put the name in the middle of a sentence and never talk about the customer in the third person.
- 1 to 3 short sentences. Sounds like a person, not a marketer.
- Do not invent dates, cutoffs, discounts, prices or slot numbers. Only mention a date or amount if it appears in the chat or the lead details.
- Do not use em dashes.
- Return only the message text.`;

  const user = `Lead: ${JSON.stringify(lead)}
Days quiet: ${daysQuiet}

Chat:
${transcript(messages)}`;

  const text = await complete("draft", system, user);
  return text.trim().replace(/^["']|["']$/g, "");
}
