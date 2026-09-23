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
  source?: string | null; // "bot" for automatic replies
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

async function complete(
  kind: "extract" | "draft" | "agent",
  system: string,
  user: string,
): Promise<string> {
  if (provider() === "openai-compatible") {
    const base = (process.env.AI_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, "");
    const specific =
      kind === "extract"
        ? process.env.AI_MODEL_EXTRACT
        : kind === "agent"
          ? process.env.AI_MODEL_AGENT || process.env.AI_MODEL_DRAFT
          : process.env.AI_MODEL_DRAFT;
    const model = specific || process.env.AI_MODEL || DEFAULT_MODEL;

    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${process.env.AI_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        temperature: kind === "agent" ? 0.2 : undefined,
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
    max_tokens: kind === "extract" ? 400 : kind === "agent" ? 700 : 300,
    ...(kind === "agent" ? { temperature: 0.2 } : {}),
    system,
    messages: [{ role: "user", content: user }],
  });
  return res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
}

function transcript(messages: ChatMessage[], labelBot = false): string {
  return messages
    .map((m) => {
      const who =
        m.direction === "in" ? "CUSTOMER" : labelBot && m.source === "bot" ? "ASSISTANT" : "OWNER";
      return `[${m.sentAt}] ${who}: ${m.body}`;
    })
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

/** Free models sometimes return sloppy JSON. Pull out the object. */
function extractJson(text: string): Record<string, unknown> {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("No JSON in AI reply");
  return JSON.parse(text.slice(start, end + 1));
}

/** Clean every lead field so a sloppy reply cannot put bad data in the database. */
function cleanLead(raw: Record<string, unknown>): LeadFields {
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
    stage: STAGE_VALUES.includes(raw.stage as Stage) ? (raw.stage as Stage) : "talking",
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
  return cleanLead(extractJson(text));
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
  ownerNote?: string;
}): Promise<string> {
  const { lead, messages, daysQuiet, toneNotes, awaitingOwnerReply, ownerNote } = args;

  if (provider() === "mock") {
    if (ownerNote) return `${ownerNote} (mock draft)`;
    return `Hi! Just checking in${lead.need ? ` about ${lead.need}` : ""}. Boleh confirm ya? (mock draft)`;
  }

  const situation = ownerNote
    ? `The owner has decided what to say: "${ownerNote}".
Write the message to the customer that says exactly that, in the owner's voice.
- Do not add offers, prices, dates or promises beyond what the owner's note and the chat state.
- Write in the customer's language, even if the owner's note is in another language.`
    : awaitingOwnerReply
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


/* ---------- Auto-reply agent ---------- */

export type EscalationReason = "discount" | "stock" | "payment" | "unsure";
export type OrderStatus = "none" | "collecting" | "awaiting_confirmation" | "confirmed";

export interface OrderState {
  status: OrderStatus;
  summary: string | null;
}

export interface AgentResult {
  action: "reply" | "escalate";
  reason: EscalationReason | null;
  reply: string;
  note: string | null; // what the owner needs to decide, when handing over
  order: OrderState;
  lead: LeadFields;
}

/** Sent to the customer when a human has to take over and the AI has nothing safe to say. */
export const HOLDING_FALLBACK = "Terima kasih! Saya check dulu dan update balik sekejap ya.";

const REASONS: EscalationReason[] = ["discount", "stock", "payment", "unsure"];

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Safety net: every RM amount in an automatic reply must come from the business facts or the chat,
 * or be a plain total of them (price times quantity, plus delivery and so on).
 * A price the AI made up sends the chat to the owner instead.
 */
export function usesUnknownAmount(reply: string, allowedText: string): boolean {
  const amounts = (text: string) =>
    [...text.matchAll(/RM\s?(\d+(?:[.,]\d+)?)/gi)].map((m) => round2(Number(m[1].replace(/,/g, ""))));

  const prices = [...new Set(amounts(allowedText))];
  const quantities = [
    ...new Set(
      `${allowedText} ${reply}`
        .match(/\d+/g)
        ?.map(Number)
        .filter((n) => n > 0 && n <= 1000) ?? [],
    ),
  ];

  const terms = new Set<number>(prices);
  for (const p of prices) for (const q of quantities) terms.add(round2(p * q));
  const list = [...terms];

  // Known if it is one term, or a sum of two or three terms.
  const known = (x: number): boolean => {
    if (terms.has(x)) return true;
    for (const a of list) {
      if (terms.has(round2(x - a))) return true;
      for (const b of list) if (terms.has(round2(x - a - b))) return true;
    }
    return false;
  };

  return amounts(reply).some((x) => !known(x));
}

/** Payment details in the settings that still say [BANK NAME] or similar must never reach a customer. */
export function hasPlaceholder(reply: string): boolean {
  return /\[[A-Za-z][A-Za-z0-9 _-]{1,40}\]/.test(reply);
}

const AGENT_LEAD_RULES = `The "lead" object has these keys: name (string or null), need (short phrase or null), budget_myr (integer RM the CUSTOMER says they can spend, or null), quoted_price_myr (integer RM price given to the customer, or null), deadline (YYYY-MM-DD or null), stage, language.
- Only use what is stated in the chat or the facts. Use null when unknown. Never guess.
- name is the customer's own name only if they gave it. Never use "kak", "abang", "boss" or similar titles as a name.
- Resolve relative dates using the message timestamps. Assume the next occurrence.
- stage is one of: new, talking (details being discussed), quoted (a price was given), won (customer confirmed and paid), lost (customer declined).
- language is the customer's main style: en, bm, or manglish.`;

export async function runAgent(args: {
  facts: string | null;
  toneNotes?: string | null;
  lead: LeadFields;
  order?: OrderState;
  messages: ChatMessage[];
}): Promise<AgentResult> {
  const { facts, toneNotes, lead, messages } = args;
  const order = args.order ?? { status: "none" as const, summary: null };

  if (provider() === "mock") return mockAgent(lead, messages, order.status);

  const system = `You are the WhatsApp sales assistant for a small Malaysian business. You answer customers on the owner's behalf, in the owner's voice. Chats mix English, Bahasa Malaysia and Manglish. Reply in the customer's language.
${toneNotes ? `Owner tone notes: ${toneNotes}` : ""}

You may ONLY use the business facts below and what is said in the chat. If something is not there, you do not know it.

BUSINESS FACTS:
${facts?.trim() || "(none provided)"}

HOW YOU WORK
You answer questions and take complete orders on your own. The owner is pulled in only for the cases under HAND OVER.

1. Check the rules first. Compare what the customer asks for with the rules in the facts: minimum order, notice needed, opening days and hours, delivery areas, anything else stated. If the request breaks a rule, say so politely and suggest what works, for example "Minimum order 12 ya, nak jadi 12?" or "Esok tak sempat, paling awal lusa ya". Do this yourself. Never hand over because a rule was broken.

2. Take the order. An order needs all of these before you summarise it: (a) the item, including flavour or type, and the quantity; (b) pickup or delivery, and the address if delivery; (c) the date; (d) the time; (e) the customer's name for the order. Ask for the name even if you can see a WhatsApp name, because it may not be their real name. Ask for what is missing, one or two questions per message, and do not hand over while you are still collecting. If the customer answers only some of it, ask for the rest.

3. Confirm. When you have everything and the order follows the rules, send an ORDER SUMMARY: items and quantities, pickup or delivery with date and time, the name, and the total. You may multiply and add prices from the facts to get the total (for example 12 x RM3 = RM36, plus RM10 delivery). Then ask the customer to confirm. If they change something, send a new summary and ask again.

4. Payment. Only after the customer clearly confirms the latest summary (for example "ok", "confirm", "boleh"), set order status to "confirmed" and reply with a short thank you that says the order is confirmed and asks them to pay and send the receipt here. Do NOT write any bank or payment details yourself: they are added automatically under your message. Never ask for payment before they confirm.

If the order is already confirmed or paid and the customer only says thanks or ok, reply with one short friendly line such as "Sama-sama!" and nothing else. Do not repeat the order, the total or any payment details, and keep the order status as it is.

Return ONLY a JSON object with exactly these keys, in this order:
- checks: one short line listing each rule from the facts that applies to this message and whether it passes. Write this first, before you decide anything else.
- action: "reply" or "escalate"
- reason: null when replying. When escalating, one of "discount", "stock", "payment", "unsure"
- reply: the message to send to the customer
- note: null when replying. When escalating, one short sentence for the owner saying what to decide, with the details. Write dates the way people say them, like "21 Sept", never 2026-09-21.
- order: an object with "status" and "summary". status is "none" (no order yet), "collecting" (still asking for details), "awaiting_confirmation" (you sent a summary and are waiting for the customer to confirm) or "confirmed" (they confirmed the summary). summary is the one-line order summary once you have one, otherwise null.
- lead: an object, described below

Things you always answer yourself, without the owner: "ada cupcake tak?", "harga berapa?", "boleh delivery ke Shah Alam?", "buka hari Ahad?", "nak order 10" when the minimum is 12, "esok boleh pickup?" when the notice needed in the facts allows it.

HAND OVER (action "escalate") only in these cases:
- "stock": only when the facts list something the owner must check (for example large orders or custom designs), or the customer asks about a specific quantity or date that the facts cannot settle. Asking whether the shop sells or has a product that is on the menu is NOT a stock question. Answer it yourself from the facts, for example "Ada! Cupcake chocolate, vanilla dan red velvet, RM3 satu, minimum order 12 ya." Never wait for the owner to confirm that a menu item exists.
- "discount": they ask for a lower price, a discount, or try to negotiate.
- "payment": they say they have paid or transferred, send a receipt, or ask you to check a payment.
- "unsure": the answer is not in the facts, the question is about something outside this business, they complain, or you are not sure.
When escalating, "reply" is a short holding message that says what you are checking. Never state or hint at what the owner will decide.

Lines marked OWNER are things the owner said or decided. Treat them as true for the rest of the chat and never ask the owner about something they already answered. Lines marked ASSISTANT are messages you sent earlier. Do not repeat them word for word.

Never agree to a discount, promise availability the facts do not support, confirm that a payment was received, or invent prices, dates, delivery areas or policies. Only state prices that come from the facts.
If the customer asks whether they are talking to a person or a bot, say honestly that you are the shop's automated assistant and that the owner can step in.

Style: 1 to 3 short sentences, like a person, not a marketer. An order summary may be a short list. Do not use em dashes. Never call the customer "kak", "abang" or any title they used for the owner. Do not repeat the customer's name in the middle of a sentence.

${AGENT_LEAD_RULES}
When you state a price from the facts, set quoted_price_myr to it.`;

  const user = `Known lead details: ${JSON.stringify(lead)}
Order so far: ${JSON.stringify(order)}

Chat (oldest first). Reply to the CUSTOMER's latest message(s) that have not been answered:
${transcript(messages, true)}`;

  const text = await complete("agent", system, user);
  const raw = extractJson(text);

  const action = raw.action === "reply" ? "reply" : "escalate";
  const reason = REASONS.includes(raw.reason as EscalationReason)
    ? (raw.reason as EscalationReason)
    : null;
  const reply = (str(raw.reply) ?? "").slice(0, 1000);

  const leadRaw =
    raw.lead && typeof raw.lead === "object" ? (raw.lead as Record<string, unknown>) : {};

  const orderRaw =
    raw.order && typeof raw.order === "object" ? (raw.order as Record<string, unknown>) : {};
  const ORDER_STATUSES: OrderStatus[] = ["none", "collecting", "awaiting_confirmation", "confirmed"];
  const orderStatus = ORDER_STATUSES.includes(orderRaw.status as OrderStatus)
    ? (orderRaw.status as OrderStatus)
    : "none";

  return {
    action,
    reason: action === "escalate" ? (reason ?? "unsure") : null,
    reply,
    note: action === "escalate" ? (str(raw.note) ?? "Please check this chat.").slice(0, 300) : null,
    order: { status: orderStatus, summary: (str(orderRaw.summary) ?? "").slice(0, 500) || null },
    lead: cleanLead(leadRaw),
  };
}

/** Free, no-network stand-in so you can test the whole flow without an AI key. */
function mockAgent(lead: LeadFields, messages: ChatMessage[], orderStatus: OrderStatus): AgentResult {
  const last = [...messages].reverse().find((m) => m.direction === "in")?.body.toLowerCase() ?? "";
  const has = (words: string[]) => words.some((w) => last.includes(w));

  const base: LeadFields = {
    ...lead,
    need: lead.need ?? "Sample need (mock mode)",
    stage: lead.stage === "new" ? "talking" : lead.stage,
  };
  const none = { status: "none" as const, summary: null };
  const hand = (reason: EscalationReason, reply: string, note: string): AgentResult => ({
    action: "escalate",
    reason,
    reply,
    note,
    order: none,
    lead: base,
  });

  if (has(["kurang", "diskaun", "discount", "murah", "mahal", "lowest"])) {
    return hand("discount", "Sekejap ya, saya check dengan boss dulu (mock).", "The customer asked for a lower price.");
  }
  if (has(["dah bayar", "transfer", "resit", "receipt", "paid"])) {
    return hand("payment", "Terima kasih! Saya check payment dulu ya (mock).", "The customer says they paid. Please check.");
  }
  if (has(["stok", "stock", "available", "slot", "masih ada"])) {
    return hand("stock", "Sekejap ya, saya check availability dulu (mock).", "The customer asked about stock or availability.");
  }

  // A tiny fake order flow: ask for details, summarise, then confirm.
  const reply = (text: string, status: OrderStatus, summary: string | null = null): AgentResult => ({
    action: "reply",
    reason: null,
    reply: text,
    note: null,
    order: { status, summary },
    lead: base,
  });

  if (orderStatus === "awaiting_confirmation" && has(["ya", "betul", "confirm", "ok", "boleh"])) {
    return reply("Terima kasih! Order confirmed (mock).", "confirmed", "Mock order");
  }
  if (orderStatus === "collecting") {
    return reply("Order summary (mock): 12 cupcakes, esok 10am, atas nama Test. Betul ke?", "awaiting_confirmation", "Mock order");
  }
  if (has(["nak", "order"])) {
    return reply("Boleh! Nama dan pukul berapa nak pickup? (mock)", "collecting");
  }
  return reply("Terima kasih! Boleh bagitahu nak berapa banyak dan bila perlu? (mock reply)", "none");
}

/** The message sent after the owner confirms a payment. */
export async function writeConfirmation(args: {
  summary: string | null;
  lead: LeadFields;
  messages: ChatMessage[];
  toneNotes?: string | null;
}): Promise<string> {
  const { summary, lead, messages, toneNotes } = args;
  const fallback = "Payment dah terima, terima kasih! Order anda confirmed.";

  if (provider() === "mock") return `${fallback} (mock)`;

  const system = `You write one short WhatsApp message for a Malaysian small business owner, in the owner's voice and in the customer's language (English, BM or Manglish).
${toneNotes ? `Owner tone notes: ${toneNotes}` : ""}
The owner has checked and received the customer's payment. Thank them, say the payment is received and the order is confirmed, and repeat the pickup or delivery date and time from the order summary.
Rules: 1 to 2 short sentences. Only use the order summary and the chat: do not invent dates, times, prices or addresses. Do not use em dashes. Never call the customer "kak", "abang" or any title they used for the owner. Return only the message text.`;

  const user = `Order summary: ${summary ?? "(none)"}
Lead: ${JSON.stringify(lead)}

Chat:
${transcript(messages, true)}`;

  try {
    const text = (await complete("draft", system, user)).trim().replace(/^["']|["']$/g, "");
    return text || fallback;
  } catch {
    return fallback;
  }
}

/* ---------- Feedback replies ---------- */

export interface FeedbackResult {
  isFeedback: boolean;
  rating: number | null;
  comment: string | null;
  unhappy: boolean;
  reply: string;
}

/** Reads a customer's answer to "how was your order?" and writes a short thank-you. */
export async function runFeedbackAgent(args: {
  messages: ChatMessage[];
  customerName: string | null;
  toneNotes?: string | null;
}): Promise<FeedbackResult> {
  const { messages, customerName, toneNotes } = args;

  if (provider() === "mock") {
    const last = [...messages].reverse().find((m) => m.direction === "in")?.body ?? "";
    const digit = last.match(/(?<!\d)[1-5](?!\d)/)?.[0];
    if (!digit) return { isFeedback: false, rating: null, comment: null, unhappy: false, reply: "" };
    const rating = Number(digit);
    return {
      isFeedback: true,
      rating,
      comment: last,
      unhappy: rating <= 3,
      reply: rating <= 3 ? "Maaf ya. Owner akan hubungi awak (mock)." : "Terima kasih banyak! (mock)",
    };
  }

  const system = `You help a Malaysian small business owner collect feedback on WhatsApp. The shop just asked the customer how their order was and to rate it from 1 to 5. Chats mix English, Bahasa Malaysia and Manglish.
${toneNotes ? `Owner tone notes: ${toneNotes}` : ""}

Read the customer's latest message. Return ONLY a JSON object with exactly these keys:
- is_feedback: true if they are answering the feedback request (a rating, an opinion, praise or a complaint). false if they are talking about something else, such as a new order or a question.
- rating: an integer from 1 to 5. Use their number if they gave one. If they only used words, judge it ("sedap sangat" is 5, "okay je" is 3, "teruk" is 1). null if you cannot tell.
- comment: what they said about the order, in a few words, or null.
- unhappy: true if they sound unhappy or complain.
- reply: a thank-you of 1 or 2 short sentences in the customer's language. If they are happy, thank them warmly. If they are unhappy or unsure, apologise and say the owner will contact them personally. Never offer a refund, discount or compensation. Do not include any link. Do not use em dashes. Empty string when is_feedback is false.`;

  const user = `Customer name: ${customerName ?? "unknown"}\n\nChat:\n${transcript(messages, true)}`;
  const raw = extractJson(await complete("agent", system, user));

  const rating = Number(raw.rating);
  return {
    isFeedback: raw.is_feedback === true,
    rating: Number.isInteger(rating) && rating >= 1 && rating <= 5 ? rating : null,
    comment: str(raw.comment)?.slice(0, 500) ?? null,
    unhappy: raw.unhappy === true,
    reply: (str(raw.reply) ?? "").slice(0, 500),
  };
}
