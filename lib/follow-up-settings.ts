// Settings for after-sale follow-ups, stored as JSON on the business row.

export type FollowUpKind = "feedback" | "reorder" | "marketing";

export interface FollowUpSettings {
  feedback: { enabled: boolean; delayDays: number; templateName: string; text: string };
  reorder: { enabled: boolean; afterDays: number; templateName: string; text: string };
  reviewLink: string;
  language: string; // language code of your WhatsApp templates, like "ms" or "en"
}

// {{1}} is the customer's first name, {{2}} what they ordered, {{3}} your review link.
export const DEFAULT_FEEDBACK_TEXT =
  "Hi {{1}}, terima kasih sebab order dengan kami! Macam mana {{2}} tu? Balas 1 hingga 5 (5 = terbaik) dan kongsi komen anda. Balas STOP untuk berhenti.";
export const DEFAULT_REORDER_TEXT =
  "Hi {{1}}, dah lama tak jumpa! Nak order {{2}} lagi? Balas mesej ini dan kami uruskan. Balas STOP untuk berhenti.";

export const DEFAULT_SETTINGS: FollowUpSettings = {
  feedback: { enabled: false, delayDays: 1, templateName: "", text: DEFAULT_FEEDBACK_TEXT },
  reorder: { enabled: false, afterDays: 30, templateName: "", text: DEFAULT_REORDER_TEXT },
  reviewLink: "",
  language: "ms",
};

const num = (v: unknown, fallback: number, min: number, max: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
};
const str = (v: unknown, fallback: string) => (typeof v === "string" ? v : fallback);

/** Read the saved JSON safely, filling in defaults for anything missing. */
export function readSettings(raw: unknown): FollowUpSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, Record<string, unknown> | string>;
  const fb = (r.feedback && typeof r.feedback === "object" ? r.feedback : {}) as Record<string, unknown>;
  const ro = (r.reorder && typeof r.reorder === "object" ? r.reorder : {}) as Record<string, unknown>;
  const d = DEFAULT_SETTINGS;
  return {
    feedback: {
      enabled: fb.enabled === true,
      delayDays: num(fb.delayDays, d.feedback.delayDays, 0, 60),
      templateName: str(fb.templateName, ""),
      text: str(fb.text, d.feedback.text) || d.feedback.text,
    },
    reorder: {
      enabled: ro.enabled === true,
      afterDays: num(ro.afterDays, d.reorder.afterDays, 1, 365),
      templateName: str(ro.templateName, ""),
      text: str(ro.text, d.reorder.text) || d.reorder.text,
    },
    reviewLink: str(r.reviewLink, ""),
    language: str(r.language, d.language) || d.language,
  };
}

export interface TemplateVars {
  name: string | null;
  items: string | null;
  link: string | null;
}

function values(vars: TemplateVars): string[] {
  const clean = (t: string) => t.replace(/\s+/g, " ").trim(); // template values cannot hold line breaks
  return [
    clean(vars.name?.trim().split(/\s+/)[0] || "kawan"),
    clean(vars.items || "pesanan anda"),
    clean(vars.link || ""),
  ];
}

/** Fill {{1}}, {{2}}, {{3}} in the text. */
export function renderText(text: string, vars: TemplateVars): string {
  const v = values(vars);
  return text.replace(/\{\{([1-3])\}\}/g, (_, i: string) => v[Number(i) - 1]);
}

/** The values to send to WhatsApp for a template, in order, up to the highest {{n}} the text uses. */
export function templateParams(text: string, vars: TemplateVars): string[] {
  const used = [...text.matchAll(/\{\{([1-3])\}\}/g)].map((m) => Number(m[1]));
  const max = used.length ? Math.max(...used) : 0;
  return values(vars).slice(0, max);
}

/** Sent with the "payment received" message so the customer can agree to follow-ups. */
export const CONSENT_ASK =
  "Kalau nak, kami boleh hantar reminder dan tawaran istimewa nanti. Balas YA untuk setuju. Balas STOP bila-bila masa untuk berhenti.";
