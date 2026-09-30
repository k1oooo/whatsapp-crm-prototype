// A minimal, in-memory stand-in for the Supabase JS client, just enough to run
// lib/whatsapp.ts and friends against real business logic without a real database.
//
// It supports exactly the query shapes this codebase uses:
//   .from(table).select(cols).eq(col, val)[.eq(...)].maybeSingle() / .single()
//   .from(table).insert(obj).select(cols).single()
//   .from(table).update(obj).eq(col, val)          (awaited directly, no terminal call)
//   .from(table).select(cols).eq(col, val).order(col, opts).order(col, opts).limit(n)
//   .from(table).select(cols).eq(col, val).gt(col, val).limit(n)
//
// It is intentionally not a general PostgREST simulator: unsupported shapes will
// silently do the wrong thing rather than throw, so keep it close to what's above.

type Row = Record<string, unknown>;
type FilterOp = readonly ["eq" | "gt", string, unknown];

export interface FakeDb {
  [table: string]: Row[];
}

// Unique indexes that matter for the flows under test (see supabase/migrations/0001_init.sql).
const UNIQUE_CONSTRAINTS: Record<string, string[][]> = {
  businesses: [["owner_id"], ["wa_phone_number_id"]],
  leads: [["business_id", "wa_contact_number"]],
  messages: [["wa_message_id"]],
  draft_replies: [["lead_id"]],
  subscriptions: [["business_id"]],
};

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

function matchesFilters(row: Row, filters: FilterOp[]): boolean {
  return filters.every(([op, col, val]) => {
    const rv = row[col];
    if (op === "eq") return rv === val;
    if (op === "gt") return rv != null && String(rv) > String(val);
    return true;
  });
}

const KNOWN_TABLES = ["businesses", "leads", "messages", "draft_replies", "subscriptions", "follow_ups", "knowledge_entries", "knowledge_documents", "feedback"];

/** Create a fresh fake client. Pass seed rows per table to start with existing data. */
export function createFakeSupabase(seed: FakeDb = {}) {
  const db: FakeDb = {};
  for (const t of KNOWN_TABLES) db[t] = [];
  for (const [table, rows] of Object.entries(seed)) db[table] = rows.map((r) => ({ ...r }));

  function tableRows(name: string): Row[] {
    if (!db[name]) db[name] = [];
    return db[name];
  }

  function from(name: string) {
    let mode: "select" | "insert" | "update" | null = null;
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
        for (const cols of UNIQUE_CONSTRAINTS[name] ?? []) {
          const conflicts =
            cols.every((c) => row[c] !== null && row[c] !== undefined) &&
            rows.some((r) => cols.every((c) => r[c] === row[c]));
          if (conflicts) {
            return {
              data: null,
              error: { code: "23505", message: `duplicate key value violates unique constraint on ${name}(${cols.join(",")})` },
            };
          }
        }
        rows.push(row);
        const out = pickCols(row, selectCols);
        return kind === "list" ? { data: [out], error: null } : { data: out, error: null };
      }

      if (mode === "update") {
        const matched = rows.filter((r) => matchesFilters(r, filters));
        for (const r of matched) Object.assign(r, payload, { updated_at: new Date().toISOString() });
        return { data: matched.map((r) => pickCols(r, selectCols)), error: null };
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
        if (!mode) mode = "select";
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
      eq(col: string, val: unknown) {
        filters.push(["eq", col, val] as const);
        return builder;
      },
      gt(col: string, val: unknown) {
        filters.push(["gt", col, val] as const);
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

  return { from, _db: db } as unknown as import("@supabase/supabase-js").SupabaseClient & { _db: FakeDb };
}

export type FakeSupabase = ReturnType<typeof createFakeSupabase>;
