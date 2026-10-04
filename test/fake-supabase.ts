// A minimal, in-memory stand-in for the Supabase JS client, just enough to run
// lib/whatsapp.ts and friends against real business logic without a real database.
//
// It supports exactly the query shapes this codebase uses:
//   .from(table).select(cols).eq(col, val)[.eq(...)].maybeSingle() / .single()
//   .from(table).insert(obj).select(cols).single()
//   .from(table).update(obj).eq(col, val)          (awaited directly, no terminal call)
//   .from(table).select(cols).eq(col, val).order(col, opts).order(col, opts).limit(n)
//   .from(table).select(cols).eq(col, val).gt(col, val).limit(n)
//   .from(table).update(obj).eq(col, val).or("a.is.null,a.neq.x").select(cols).maybeSingle()   (claim pattern)
//   .from(table).delete().eq(col, val).select(cols).maybeSingle()                              (claim pattern)
//
// It is intentionally not a general PostgREST simulator: unsupported shapes will
// silently do the wrong thing rather than throw, so keep it close to what's above.

type Row = Record<string, unknown>;
type FilterOp = readonly ["eq" | "gt" | "gte" | "lt" | "lte" | "in" | "neq" | "is" | "or", string, unknown];

export interface FakeDb {
  [table: string]: Row[];
}

// Unique indexes that matter for the flows under test (see supabase/migrations/0001_init.sql).
// A partial index (a `where` predicate) only counts rows the predicate accepts.
type Unique = string[] | { cols: string[]; where: (r: Row) => boolean };
const UNIQUE_CONSTRAINTS: Record<string, Unique[]> = {
  businesses: [["owner_id"], ["wa_phone_number_id"]],
  leads: [["business_id", "wa_contact_number"]],
  messages: [["business_id", "wa_message_id"]],
  draft_replies: [["lead_id"]],
  subscriptions: [["business_id"]],
  // 0007: a follow-up is queued once per chat, kind and order.
  follow_ups: [["lead_id", "kind", "order_key"]],
  // 0015: one waiting and one running job per chat.
  inbound_jobs: [
    { cols: ["lead_id"], where: (r) => r.status === "queued" },
    { cols: ["lead_id"], where: (r) => r.status === "running" },
  ],
};

/** The first unique index that `row` would break against the other rows, if any. */
function uniqueViolation(table: string, row: Row, others: Row[]): string | null {
  for (const spec of UNIQUE_CONSTRAINTS[table] ?? []) {
    const cols = Array.isArray(spec) ? spec : spec.cols;
    const where = Array.isArray(spec) ? () => true : spec.where;
    if (!where(row) || !cols.every((c) => row[c] !== null && row[c] !== undefined)) continue;
    if (others.some((r) => r !== row && where(r) && cols.every((c) => r[c] === row[c]))) {
      return `${table}(${cols.join(",")})`;
    }
  }
  return null;
}

// Column defaults so a minimal insert() in a test still produces a row that satisfies
// every column lib/whatsapp.ts might select, matching the "not null default ..." columns
// added across supabase/migrations/000*.sql.
const DEFAULTS: Record<string, Row> = {
  leads: {
    name: null,
    need: null,
    budget_myr: null,
    quoted_price_myr: null,
    deadline: null,
    stage: "new",
    language: null,
    last_message_at: null,
    last_inbound_at: null,
    last_outbound_at: null,
    last_chased_at: null,
    bot_paused_until: null,
    locked_fields: [] as string[],
    pending_decision: false,
    human_reason: null,
    handoff_note: null,
    order_status: null,
    order_summary: null,
    follow_up_consent: "unknown",
    consent_asked_at: null,
    awaiting_feedback: false,
    paid_at: null,
    order_lines: null,
    order_total_myr: null,
  },
  inbound_jobs: {
    status: "queued",
    attempts: 0,
    run_after: "1970-01-01T00:00:00.000Z", // due immediately
    locked_until: null,
    last_error: null,
  },
  businesses: {
    auto_reply: false,
    business_facts: null,
    tone_notes: null,
    wa_access_token: null,
    wa_app_secret: null,
    wa_verify_token: null,
    wa_owner_number: null,
    payment_details: null,
    cold_after_days: 3,
    follow_up_settings: {},
  },
  messages: {},
  knowledge_entries: {},
  knowledge_documents: {},
  follow_ups: {},
  feedback: {},
};

function pickCols(row: Row, cols: string | undefined): Row {
  if (!cols || cols.trim() === "*") return { ...row };
  const names = cols
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);
  const out: Row = {};
  for (const n of names) out[n] = row[n] ?? null;
  return out;
}

/** Split on commas that are not inside parentheses: "a.is.null,and(b.eq.1,c.eq.2)". */
function splitTop(expr: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of expr) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      parts.push(cur);
      cur = "";
    } else cur += ch;
  }
  if (cur) parts.push(cur);
  return parts;
}

/** One clause of a PostgREST .or() string, such as "order_status.is.null" or "and(a.lt.1,b.is.null)". */
function matchesOrClause(row: Row, clause: string): boolean {
  const c = clause.trim();
  if (c.startsWith("and(") && c.endsWith(")")) return splitTop(c.slice(4, -1)).every((x) => matchesOrClause(row, x));
  const [col, op, ...rest] = c.split(".");
  const val = rest.join(".");
  const rv = row[col];
  if (op === "is") return val === "null" ? rv == null : String(rv) === val;
  if (op === "neq") return rv != null && String(rv) !== val; // SQL: NULL <> 'x' is not true
  if (op === "eq") return rv != null && String(rv) === val;
  if (op === "lt") return rv != null && String(rv) < val;
  if (op === "gt") return rv != null && String(rv) > val;
  return false;
}

function matchesFilters(row: Row, filters: FilterOp[]): boolean {
  return filters.every(([op, col, val]) => {
    const rv = row[col];
    if (op === "eq") return rv === val;
    if (op === "gt") return rv != null && String(rv) > String(val);
    if (op === "gte") return rv != null && String(rv) >= String(val);
    if (op === "lt") return rv != null && String(rv) < String(val);
    if (op === "lte") return rv != null && String(rv) <= String(val);
    if (op === "in") return (val as unknown[]).includes(rv);
    if (op === "neq") return rv != null && rv !== val;
    if (op === "is") return val === null ? rv == null : rv === val;
    if (op === "or") return splitTop(String(val)).some((c) => matchesOrClause(row, c));
    return true;
  });
}

const KNOWN_TABLES = ["businesses", "leads", "messages", "draft_replies", "subscriptions", "follow_ups", "knowledge_entries", "knowledge_documents", "feedback"];

/** Create a fresh fake client. Pass seed rows per table to start with existing data. */
/**
 * A table that is not in the database (a migration was not applied): every query on it answers with
 * Postgres's "undefined table" error, the way the real API does.
 */
function missingTableBuilder(table: string) {
  const result = { data: null, error: { code: "42P01", message: `relation "public.${table}" does not exist` } };
  const proxy: unknown = new Proxy(() => undefined, {
    get: (_t, prop) => (prop === "then" ? (resolve: (v: unknown) => unknown) => resolve(result) : () => proxy),
  });
  return proxy;
}

export interface FakeOptions {
  /** Tables to act as if they do not exist. Missing "inbound_jobs" also removes claim_inbound_jobs. */
  missingTables?: string[];
}

export function createFakeSupabase(seed: FakeDb = {}, options: FakeOptions = {}) {
  const db: FakeDb = {};
  for (const t of KNOWN_TABLES) db[t] = [];
  for (const [table, rows] of Object.entries(seed)) db[table] = rows.map((r) => ({ ...r }));

  function tableRows(name: string): Row[] {
    if (!db[name]) db[name] = [];
    return db[name];
  }

  function from(name: string) {
    if (options.missingTables?.includes(name)) return missingTableBuilder(name) as never;
    let mode: "select" | "insert" | "update" | "delete" | null = null;
    let payload: Row | undefined;
    let selectCols: string | undefined;
    const filters: FilterOp[] = [];
    const orders: { col: string; ascending: boolean }[] = [];
    let limitN: number | undefined;

    async function run(kind: "list" | "single" | "maybeSingle") {
      const rows = tableRows(name);

      if (mode === "insert") {
        const row: Row = {
          id: crypto.randomUUID(),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          ...(DEFAULTS[name] ?? {}),
          ...payload,
        };
        const clash = uniqueViolation(name, row, rows);
        if (clash) {
          return {
            data: null,
            error: { code: "23505", message: `duplicate key value violates unique constraint on ${clash}` },
          };
        }
        rows.push(row);
        const out = pickCols(row, selectCols);
        return kind === "list" ? { data: [out], error: null } : { data: out, error: null };
      }

      if (mode === "update" || mode === "delete") {
        const matched = rows.filter((r) => matchesFilters(r, filters));
        if (mode === "update") {
          const before = matched.map((r) => ({ ...r }));
          for (const r of matched) Object.assign(r, payload, { updated_at: new Date().toISOString() });
          // Postgres rejects the whole statement if the new values break a unique index.
          const clash = matched.map((r) => uniqueViolation(name, r, rows)).find(Boolean);
          if (clash) {
            matched.forEach((r, i) => Object.assign(r, before[i]));
            return { data: null, error: { code: "23505", message: `duplicate key value violates unique constraint on ${clash}` } };
          }
        } else {
          for (const r of matched) rows.splice(rows.indexOf(r), 1);
        }
        const out = matched.map((r) => pickCols(r, selectCols));
        if (kind === "single") {
          return out.length === 1 ? { data: out[0], error: null } : { data: null, error: { code: "PGRST116", message: "no rows found" } };
        }
        if (kind === "maybeSingle") return { data: out[0] ?? null, error: null };
        return { data: out, error: null };
      }

      // select
      let result = rows.filter((r) => matchesFilters(r, filters));
      for (const { col, ascending } of [...orders].reverse()) {
        result = [...result].sort((a, b) => {
          const av = String(a[col] ?? "");
          const bv = String(b[col] ?? "");
          if (av < bv) return ascending ? -1 : 1;
          if (av > bv) return ascending ? 1 : -1;
          return 0;
        });
      }
      if (limitN != null) result = result.slice(0, limitN);

      if (kind === "single") {
        if (result.length !== 1) return { data: null, error: { code: "PGRST116", message: "no rows found" } };
        return { data: pickCols(result[0], selectCols), error: null };
      }
      if (kind === "maybeSingle") {
        return { data: result[0] ? pickCols(result[0], selectCols) : null, error: null };
      }
      return { data: result.map((r) => pickCols(r, selectCols)), error: null };
    }

    const builder = {
      select(cols?: string) {
        if (!mode) mode = "select"; // after update()/delete() this only sets which columns come back
        selectCols = cols;
        return builder;
      },
      insert(obj: Row) {
        mode = "insert";
        payload = obj;
        return builder;
      },
      // Minimal upsert: only supports the shape lib/whatsapp.ts uses — a single onConflict
      // column, no returned row needed by the caller.
      upsert(obj: Row, opts?: { onConflict?: string }) {
        const conflictCol = opts?.onConflict;
        const rows = tableRows(name);
        const existing = conflictCol ? rows.find((r) => r[conflictCol] === obj[conflictCol]) : undefined;
        if (existing) {
          mode = "update";
          payload = obj;
          filters.push(["eq", conflictCol as string, obj[conflictCol as string]] as const);
        } else {
          mode = "insert";
          payload = obj;
        }
        return builder;
      },
      update(obj: Row) {
        mode = "update";
        payload = obj;
        return builder;
      },
      delete() {
        mode = "delete";
        return builder;
      },
      neq(col: string, val: unknown) {
        filters.push(["neq", col, val] as const);
        return builder;
      },
      is(col: string, val: unknown) {
        filters.push(["is", col, val] as const);
        return builder;
      },
      or(expr: string) {
        filters.push(["or", "", expr] as const);
        return builder;
      },
      eq(col: string, val: unknown) {
        filters.push(["eq", col, val] as const);
        return builder;
      },
      gt(col: string, val: unknown) {
        filters.push(["gt", col, val] as const);
        return builder;
      },
      gte(col: string, val: unknown) {
        filters.push(["gte", col, val] as const);
        return builder;
      },
      lte(col: string, val: unknown) {
        filters.push(["lte", col, val] as const);
        return builder;
      },
      lt(col: string, val: unknown) {
        filters.push(["lt", col, val] as const);
        return builder;
      },
      in(col: string, vals: unknown[]) {
        filters.push(["in", col, vals] as const);
        return builder;
      },
      order(col: string, opts?: { ascending?: boolean }) {
        orders.push({ col, ascending: opts?.ascending !== false });
        return builder;
      },
      limit(n: number) {
        limitN = n;
        return builder;
      },
      single() {
        return run("single");
      },
      maybeSingle() {
        return run("maybeSingle");
      },
      // Lets callers `await db.from(...).update(...).eq(...)` with no terminal call, the
      // same way the real supabase-js query builder is itself a thenable.
      then(onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) {
        return run("list").then(onFulfilled, onRejected);
      },
    };

    return builder;
  }

  // The one stored function the app calls. This mirrors claim_inbound_jobs in 0015_reliability.sql;
  // the SQL itself was exercised against a real Postgres (see the notes in SETUP.md).
  async function rpc(fn: string, args: { p_limit?: number; p_lease_seconds?: number; p_max_attempts?: number } = {}) {
    if (fn !== "claim_inbound_jobs") return { data: null, error: { message: `unknown function ${fn}` } };
    if (options.missingTables?.includes("inbound_jobs")) {
      return { data: null, error: { code: "PGRST202", message: "Could not find the function public.claim_inbound_jobs in the schema cache" } };
    }
    const jobs = (db.inbound_jobs ??= []);
    const { p_limit = 5, p_lease_seconds = 300, p_max_attempts = 5 } = args;
    const now = Date.now();
    const at = (v: unknown) => (v ? new Date(String(v)).getTime() : 0);

    // 1. Recover jobs whose worker died.
    for (const s of jobs.filter((j) => j.status === "running" && at(j.locked_until) < now)) {
      const queued = jobs.some((q) => q.lead_id === s.lead_id && q.status === "queued");
      s.status = queued ? "superseded" : Number(s.attempts) >= p_max_attempts ? "failed" : "queued";
      s.last_error = s.last_error ?? "The worker stopped before finishing.";
      s.locked_until = null;
      if (s.status === "failed") {
        const lead = db.leads?.find((l) => l.id === s.lead_id);
        if (lead) Object.assign(lead, { pending_decision: true, human_reason: "unsure" });
      }
    }

    // 2. Claim due jobs for chats with nothing running.
    const due = jobs
      .filter((j) => j.status === "queued" && at(j.run_after) <= now)
      .filter((j) => !jobs.some((r) => r.lead_id === j.lead_id && r.status === "running"))
      .sort((a, b) => at(a.run_after) - at(b.run_after) || at(a.created_at) - at(b.created_at))
      .slice(0, p_limit);
    for (const j of due) {
      j.status = "running";
      j.attempts = Number(j.attempts) + 1;
      j.locked_until = new Date(now + p_lease_seconds * 1000).toISOString();
    }
    return { data: due.map((j) => ({ ...j })), error: null };
  }

  return { from, rpc, _db: db } as unknown as import("@supabase/supabase-js").SupabaseClient & { _db: FakeDb };
}

export type FakeSupabase = ReturnType<typeof createFakeSupabase>;
