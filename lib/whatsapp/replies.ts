// Reading a customer's reply: opt-out (STOP) and consent (YA).

/* ---------- Opt-out and consent replies ---------- */

// Words that can follow an opt-out keyword without changing its meaning ("stop please", "berhenti hantar").
const OPT_OUT_KEYWORDS = new Set(["stop", "unsubscribe", "berhenti", "henti"]);
const OPT_OUT_FILLER = new Set(["please", "pls", "plz", "tolong", "semua", "mesej", "message", "messages", "hantar", "send", "lagi", "sms"]);

/** Lowercase, drop punctuation and emoji, collapse spaces. */
function normalizeReply(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * True when the whole message is an opt-out. It has to be the keyword on its own (plus a few filler
 * words), not just start with it: "stop at Shah Alam for delivery" is an order detail, not an opt-out.
 * "batal" is left out on purpose. In Malay it means "cancel", and "batal order tadi" must reach the
 * order assistant, not silently switch off follow-ups.
 */
export function isOptOut(text: string): boolean {
  const words = normalizeReply(text).split(" ").filter(Boolean);
  if (words.length === 0 || words.length > 4) return false;
  return OPT_OUT_KEYWORDS.has(words[0]) && words.slice(1).every((w) => OPT_OUT_FILLER.has(w));
}

/** An explicit yes to the follow-up offer. A bare "ok" or "boleh" is not marketing consent. */
export function isConsentYes(text: string): boolean {
  return ["ya", "yes", "setuju"].includes(normalizeReply(text));
}
