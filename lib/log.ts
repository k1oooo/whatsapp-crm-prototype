// Structured logging. One JSON object per line, so a log drain (Vercel, Datadog, Logtail) can filter
// and alert on `event` and group by `leadId`, `jobId` and so on, instead of grepping free text.
//
//   log.error("inbound_job.failed", { jobId, leadId, attempt }, err);
//   const l = log.child({ leadId, businessId });  l.info("lead.refreshed");
//
// Never put message text, phone numbers, tokens or secrets in the fields. IDs only.

type Level = "debug" | "info" | "warn" | "error";
type Fields = Record<string, unknown>;

const LEVEL_RANK: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function minLevel(): number {
  const wanted = (process.env.LOG_LEVEL ?? "info").toLowerCase() as Level;
  return LEVEL_RANK[wanted] ?? LEVEL_RANK.info;
}

function describeError(err: unknown): Fields {
  if (err instanceof Error) {
    return { error: err.message.slice(0, 500), errorName: err.name, ...(err.stack ? { stack: err.stack.split("\n").slice(1, 4).join(" | ").slice(0, 400) } : {}) };
  }
  if (err && typeof err === "object") {
    // A Supabase/PostgREST error is a plain object with code and message.
    const o = err as { message?: unknown; code?: unknown };
    return { error: String(o.message ?? "unknown error").slice(0, 500), ...(o.code ? { errorCode: String(o.code) } : {}) };
  }
  return err === undefined ? {} : { error: String(err).slice(0, 500) };
}

function emit(level: Level, event: string, base: Fields, fields?: Fields, err?: unknown) {
  if (LEVEL_RANK[level] < minLevel()) return;
  const line = JSON.stringify({ ts: new Date().toISOString(), level, event, ...base, ...fields, ...describeError(err) });
  // stdout for info and debug, stderr for the rest, so platforms colour them correctly.
  (level === "error" ? console.error : level === "warn" ? console.warn : console.log)(line);
}

export interface Logger {
  debug(event: string, fields?: Fields): void;
  info(event: string, fields?: Fields): void;
  warn(event: string, fields?: Fields, err?: unknown): void;
  error(event: string, fields?: Fields, err?: unknown): void;
  /** A logger that adds these fields to every line, such as the lead or job being worked on. */
  child(fields: Fields): Logger;
}

function make(base: Fields): Logger {
  return {
    debug: (event, fields) => emit("debug", event, base, fields),
    info: (event, fields) => emit("info", event, base, fields),
    warn: (event, fields, err) => emit("warn", event, base, fields, err),
    error: (event, fields, err) => emit("error", event, base, fields, err),
    child: (fields) => make({ ...base, ...fields }),
  };
}

export const log: Logger = make({});
