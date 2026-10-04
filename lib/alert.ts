// Tells a human when something needs them. Posts a short message to ALERT_WEBHOOK_URL (a Slack or
// Discord "incoming webhook", or anything that accepts {"text": "..."}). Without that variable it only
// logs, so it is safe to call everywhere.
//
// Best effort by design: an alert that fails must never break the work that raised it. And a storm of
// identical alerts (a provider outage failing a hundred jobs) sends one message, not a hundred.
import { log } from "@/lib/log";

const COOLDOWN_MS = 10 * 60_000;
const lastSent = new Map<string, number>();

/** Forget past alerts. For tests. */
export function resetAlertCooldowns() {
  lastSent.clear();
}

export async function alert(
  event: string,
  message: string,
  opts: { key?: string; fields?: Record<string, unknown>; now?: () => number } = {},
): Promise<boolean> {
  const now = (opts.now ?? Date.now)();
  const key = opts.key ?? event;
  log.error(event, { alert: true, ...opts.fields });

  const url = process.env.ALERT_WEBHOOK_URL;
  if (!url) return false;
  const last = lastSent.get(key);
  if (last !== undefined && now - last < COOLDOWN_MS) return false;
  lastSent.set(key, now);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: `[whatsapp-crm] ${message}` }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      log.warn("alert.delivery_failed", { status: res.status, event });
      return false;
    }
    return true;
  } catch (err) {
    log.warn("alert.delivery_failed", { event }, err);
    return false;
  }
}
