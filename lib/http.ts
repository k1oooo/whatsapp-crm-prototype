// Outbound HTTP with a timeout and bounded retries. Every call to WhatsApp or the AI provider goes
// through here, so one hung connection can not hold a webhook worker until the platform kills it.

export interface FetchOptions {
  /** Per attempt. */
  timeoutMs?: number;
  /** Extra attempts after the first one. */
  retries?: number;
  baseDelayMs?: number;
  /**
   * Decide whether a failed attempt is worth repeating. `res` is set when the server answered,
   * `err` when it did not (timeout, connection reset). Defaults to "safe to repeat": a network
   * error, a 429, or a 5xx. Sending a WhatsApp message must NOT use the default, see send.ts.
   */
  shouldRetry?: (outcome: { res?: Response; err?: unknown }) => boolean;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

export const retryAnything = ({ res }: { res?: Response; err?: unknown }) =>
  !res || res.status === 429 || res.status >= 500;

/** Only a 429 is a promise that the request was NOT processed, so only that is safe to repeat for a send. */
export const retryOnlyRateLimit = ({ res }: { res?: Response; err?: unknown }) => res?.status === 429;

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Exponential backoff with full jitter, and a ceiling so a retry never waits long. */
export function backoffMs(attempt: number, baseDelayMs: number, random: () => number = Math.random): number {
  return Math.round(random() * Math.min(baseDelayMs * 2 ** attempt, 4000));
}

function retryAfterMs(res: Response): number | null {
  const header = res.headers.get("retry-after");
  const seconds = header ? Number(header) : NaN;
  return Number.isFinite(seconds) && seconds >= 0 ? Math.min(seconds * 1000, 4000) : null;
}

export async function fetchWithRetry(
  url: string,
  init: RequestInit = {},
  options: FetchOptions = {},
): Promise<Response> {
  const {
    timeoutMs = 15_000,
    retries = 2,
    baseDelayMs = 400,
    shouldRetry = retryAnything,
    sleep = realSleep,
    random = Math.random,
  } = options;

  for (let attempt = 0; ; attempt++) {
    let res: Response | undefined;
    let err: unknown;
    try {
      res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
      // 2xx, 3xx and every 4xx except 429 are the server's final answer.
      if (res.ok || !shouldRetry({ res })) return res;
    } catch (e) {
      err = e;
      if (!shouldRetry({ err })) throw e;
    }

    if (attempt >= retries) {
      if (res) return res; // let the caller read the status and body
      throw err;
    }
    const wait = (res && retryAfterMs(res)) ?? backoffMs(attempt, baseDelayMs, random);
    await sleep(wait);
  }
}
