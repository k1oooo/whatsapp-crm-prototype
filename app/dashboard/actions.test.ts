import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase, type FakeDb } from "@/test/fake-supabase";

// The actions talk to Supabase through these two factories. Point both at one in-memory database.
let db: ReturnType<typeof createFakeSupabase>;
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    ...db,
    auth: { getUser: async () => ({ data: { user: { id: "owner-1" } } }) },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => db }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { connectWhatsAppEmbedded, saveSettings, saveWhatsAppConnection, toggleAutoReply } from "@/app/dashboard/actions/settings";
import { answerHandoff, confirmPayment, sendDraftReply } from "@/app/dashboard/actions/replies";

const noState = {} as never;
const form = (fields: Record<string, string> = {}) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};

function seed(extra: FakeDb = {}) {
  db = createFakeSupabase({
    businesses: [
      { id: "biz-1", owner_id: "owner-1", name: "Test Bakery", wa_phone_number_id: "123456789012345", tone_notes: null, wa_access_token: null },
    ],
    leads: [
      {
        id: "lead-1",
        business_id: "biz-1",
        wa_contact_number: "60123456789",
        name: "Aina",
        stage: "negotiating",
        order_status: "confirmed",
        order_summary: "12 cupcakes, esok 10am",
        locked_fields: [],
        follow_up_consent: "unknown",
      },
    ],
    subscriptions: [{ business_id: "biz-1", status: "active", trial_ends_at: null, current_period_end: null }],
    ...extra,
  });
}

const botMessages = () => db._db.messages.filter((m) => m.direction === "out");

beforeEach(() => {
  delete process.env.AI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.WHATSAPP_SEND_MODE;
  delete process.env.WHATSAPP_ACCESS_TOKEN;
  seed();
});
afterEach(() => vi.unstubAllGlobals());

describe("AI cost guards on owner actions", () => {
  const expired = { business_id: "biz-1", status: "trialing", trial_ends_at: "2020-01-01T00:00:00Z", current_period_end: null };

  it("REGRESSION: confirmPayment does not call the AI or message anyone when the subscription is not active", async () => {
    seed({ subscriptions: [expired] });
    const res = await confirmPayment("lead-1", noState, form());
    expect(res.error).toMatch(/trial has ended/i);
    expect(db._db.leads[0].order_status).toBe("confirmed");
    expect(botMessages()).toHaveLength(0);
  });

  it("REGRESSION: answerHandoff is refused with no subscription row at all", async () => {
    seed({ subscriptions: [] });
    const res = await answerHandoff("lead-1", noState, form({ note: "yes, 10% off" }));
    expect(res.error).toMatch(/subscribe/i);
    expect(botMessages()).toHaveLength(0);
  });

  it("stops both once the business has used its daily allowance", async () => {
    process.env.AI_DAILY_MESSAGE_LIMIT = "2";
    try {
      const now = new Date().toISOString();
      seed({
        messages: [
          { business_id: "biz-1", lead_id: "lead-1", direction: "in", body: "a", created_at: now },
          { business_id: "biz-1", lead_id: "lead-1", direction: "in", body: "b", created_at: now },
        ],
      });
      expect((await answerHandoff("lead-1", noState, form({ note: "ok" }))).error).toMatch(/daily limit/i);
      expect((await confirmPayment("lead-1", noState, form())).error).toMatch(/daily limit/i);
      expect(botMessages()).toHaveLength(0);
    } finally {
      delete process.env.AI_DAILY_MESSAGE_LIMIT;
    }
  });

  it("does not count messages older than a day", async () => {
    process.env.AI_DAILY_MESSAGE_LIMIT = "1";
    try {
      const old = new Date(Date.now() - 2 * 86_400_000).toISOString();
      seed({ messages: [{ business_id: "biz-1", lead_id: "lead-1", direction: "in", body: "old", created_at: old }] });
      expect((await confirmPayment("lead-1", noState, form())).error).toBeUndefined();
    } finally {
      delete process.env.AI_DAILY_MESSAGE_LIMIT;
    }
  });
});

describe("confirmPayment", () => {
  it("marks the order paid and tells the customer once", async () => {
    const res = await confirmPayment("lead-1", noState, form());
    expect(res.error).toBeUndefined();
    expect(db._db.leads[0].order_status).toBe("paid");
    expect(db._db.leads[0].stage).toBe("won");
    expect(botMessages()).toHaveLength(1);
  });

  it("refuses a second confirmation instead of messaging the customer again", async () => {
    await confirmPayment("lead-1", noState, form());
    const again = await confirmPayment("lead-1", noState, form());
    expect(again.error).toMatch(/already marked as paid/i);
    expect(botMessages()).toHaveLength(1);
  });

  it("REGRESSION: a double click sends one confirmation, not two", async () => {
    const [a, b] = await Promise.all([
      confirmPayment("lead-1", noState, form()),
      confirmPayment("lead-1", noState, form()),
    ]);
    // Both clicks read "not paid yet"; only one may win the claim.
    expect([a.error, b.error].filter(Boolean)).toHaveLength(1);
    expect(botMessages()).toHaveLength(1);
  });

  it("gives the order back when the message could not be sent", async () => {
    process.env.WHATSAPP_SEND_MODE = "live";
    process.env.WHATSAPP_ACCESS_TOKEN = "tok";
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 500 })));

    const res = await confirmPayment("lead-1", noState, form());
    expect(res.error).toBeTruthy();
    expect(db._db.leads[0].order_status).toBe("confirmed");
    expect(botMessages()).toHaveLength(0);
  });
});

describe("sendDraftReply", () => {
  const draft = { lead_id: "lead-1", business_id: "biz-1", body: "Boleh kak, RM36 ya.", order_status: null, order_summary: null };

  it("sends the draft and clears it", async () => {
    seed({ draft_replies: [draft] });
    const res = await sendDraftReply("lead-1", noState, form());
    expect(res.error).toBeUndefined();
    expect(botMessages()).toHaveLength(1);
    expect(botMessages()[0].body).toBe("Boleh kak, RM36 ya.");
    expect(db._db.draft_replies).toHaveLength(0);
  });

  it("sends the owner's edit instead of the original", async () => {
    seed({ draft_replies: [draft] });
    await sendDraftReply("lead-1", noState, form({ body: "Boleh kak, RM35 je." }));
    expect(botMessages()[0].body).toBe("Boleh kak, RM35 je.");
  });

  it("REGRESSION: a double click sends the draft once", async () => {
    seed({ draft_replies: [draft] });
    const [a, b] = await Promise.all([
      sendDraftReply("lead-1", noState, form()),
      sendDraftReply("lead-1", noState, form()),
    ]);
    expect([a.error, b.error].filter(Boolean)).toHaveLength(1);
    expect(botMessages()).toHaveLength(1);
  });

  it("puts the draft back, with the owner's edit, when sending fails", async () => {
    seed({ draft_replies: [draft] });
    process.env.WHATSAPP_SEND_MODE = "live";
    process.env.WHATSAPP_ACCESS_TOKEN = "tok";
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 500 })));

    const res = await sendDraftReply("lead-1", noState, form({ body: "Edited reply" }));
    expect(res.error).toBeTruthy();
    expect(botMessages()).toHaveLength(0);
    expect(db._db.draft_replies).toHaveLength(1);
    expect(db._db.draft_replies[0].body).toBe("Edited reply");
  });

  it("does not resurrect a draft when a newer one was written meanwhile", async () => {
    seed({ draft_replies: [draft] });
    process.env.WHATSAPP_SEND_MODE = "live";
    process.env.WHATSAPP_ACCESS_TOKEN = "tok";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        db._db.draft_replies.push({ ...draft, id: "newer", body: "Newer draft" });
        return new Response("{}", { status: 500 });
      }),
    );
    await sendDraftReply("lead-1", noState, form());
    expect(db._db.draft_replies).toHaveLength(1);
    expect(db._db.draft_replies[0].body).toBe("Newer draft");
  });

  it("says so when the draft is already gone", async () => {
    const res = await sendDraftReply("lead-1", noState, form());
    expect(res.error).toMatch(/no longer there/i);
    expect(botMessages()).toHaveLength(0);
  });
});

describe("saveWhatsAppConnection", () => {
  const goodForm = {
    wa_phone_number_id: "999888777666555",
    wa_app_secret: "app-secret",
    wa_access_token: "own-token",
  };
  const live = () => {
    process.env.WHATSAPP_SEND_MODE = "live";
    process.env.WHATSAPP_ACCESS_TOKEN = "shared-token";
  };

  it("refuses an access token with no app secret", async () => {
    const res = await saveWhatsAppConnection(noState, form({ wa_phone_number_id: "999888777666555", wa_access_token: "own-token" }));
    expect(res.error).toMatch(/app secret/i);
    expect(db._db.businesses[0].wa_phone_number_id).toBe("123456789012345");
  });

  it("checks the number with WhatsApp in live mode and saves it when accepted", async () => {
    live();
    const f = vi.fn(async () => new Response(JSON.stringify({ id: "999888777666555" }), { status: 200 }));
    vi.stubGlobal("fetch", f);
    const res = await saveWhatsAppConnection(noState, form(goodForm));
    expect(res.error).toBeUndefined();
    expect(f).toHaveBeenCalledTimes(1);
    expect((f.mock.calls[0] as unknown as [string, RequestInit])[1].headers).toMatchObject({ authorization: "Bearer own-token" });
    expect(db._db.businesses[0].wa_phone_number_id).toBe("999888777666555");
  });

  it("does not save a number WhatsApp will not confirm", async () => {
    live();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 400 })));
    const res = await saveWhatsAppConnection(noState, form(goodForm));
    expect(res.error).toBeTruthy();
    expect(db._db.businesses[0].wa_phone_number_id).toBe("123456789012345");
    expect(db._db.businesses[0].wa_access_token).toBeNull();
  });

  it("REGRESSION: a tenant with no token of their own cannot claim a number through the shared token", async () => {
    live();
    const f = vi.fn(async () => new Response(JSON.stringify({ id: "999888777666555" }), { status: 200 }));
    vi.stubGlobal("fetch", f);
    const res = await saveWhatsAppConnection(noState, form({ wa_phone_number_id: "999888777666555" }));
    expect(res.error).toMatch(/own WhatsApp access token/i);
    expect(f).not.toHaveBeenCalled();
    expect(db._db.businesses[0].wa_phone_number_id).toBe("123456789012345");
  });

  it("verifies against the shared token only for an operator account", async () => {
    live();
    process.env.WHATSAPP_SHARED_TOKEN_OWNER_IDS = "someone-else, owner-1";
    const f = vi.fn(async () => new Response(JSON.stringify({ id: "999888777666555" }), { status: 200 }));
    vi.stubGlobal("fetch", f);
    try {
      await saveWhatsAppConnection(noState, form({ wa_phone_number_id: "999888777666555" }));
      expect((f.mock.calls[0] as unknown as [string, RequestInit])[1].headers).toMatchObject({ authorization: "Bearer shared-token" });
    } finally {
      delete process.env.WHATSAPP_SHARED_TOKEN_OWNER_IDS;
    }
  });

  it("skips the WhatsApp check in test mode", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    const res = await saveWhatsAppConnection(noState, form({ wa_phone_number_id: "TEST_PHONE_NUMBER_ID" }));
    expect(res.error).toBeUndefined();
    expect(f).not.toHaveBeenCalled();
    expect(db._db.businesses[0].wa_phone_number_id).toBe("TEST_PHONE_NUMBER_ID");
  });
});

describe("credentials at rest", () => {
  it("stores the access token and app secret encrypted, and the verify token as typed", async () => {
    process.env.WA_SECRETS_KEY = Buffer.alloc(32, 5).toString("base64");
    try {
      const res = await saveWhatsAppConnection(
        noState,
        form({ wa_phone_number_id: "TEST_PHONE_NUMBER_ID", wa_app_secret: "my-secret", wa_access_token: "my-token", wa_verify_token: "verify-me" }),
      );
      expect(res.error).toBeUndefined();
      const row = db._db.businesses[0];
      expect(String(row.wa_access_token)).toMatch(/^enc:v1:/);
      expect(String(row.wa_app_secret)).toMatch(/^enc:v1:/);
      expect(JSON.stringify(row)).not.toContain("my-token");
      expect(JSON.stringify(row)).not.toContain("my-secret");
      expect(row.wa_verify_token).toBe("verify-me");
    } finally {
      delete process.env.WA_SECRETS_KEY;
    }
  });

  it("refuses to save credentials in production when the server has no key", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await saveWhatsAppConnection(noState, form({ wa_phone_number_id: "TEST_PHONE_NUMBER_ID", wa_app_secret: "s", wa_access_token: "t" }));
    expect(res.error).toMatch(/WA_SECRETS_KEY/);
    expect(db._db.businesses[0].wa_access_token).toBeNull();
    vi.unstubAllEnvs();
  });
});

describe("a save that changes nothing is reported, not shown as saved", () => {
  // The signed-in user (owner-1) owns no business: row level security would match no rows.
  const orphan = () => {
    db._db.businesses[0].owner_id = "someone-else";
  };

  it("saveWhatsAppConnection", async () => {
    orphan();
    const res = await saveWhatsAppConnection(noState, form({ wa_phone_number_id: "TEST_PHONE_NUMBER_ID" }));
    expect(res.ok).toBeUndefined();
    expect(res.error).toMatch(/nothing was saved/i);
    expect(db._db.businesses[0].wa_phone_number_id).toBe("123456789012345");
  });

  it("saveSettings", async () => {
    orphan();
    const res = await saveSettings(noState, form({ auto_reply: "on" }));
    expect(res.error).toMatch(/nothing was saved/i);
  });

  it("toggleAutoReply", async () => {
    orphan();
    const res = await toggleAutoReply(true);
    expect(res.error).toMatch(/nothing was saved/i);
  });

  it("still saves normally for the owner", async () => {
    const a = await saveWhatsAppConnection(noState, form({ wa_phone_number_id: "TEST_PHONE_NUMBER_ID" }));
    const b = await saveSettings(noState, form({ auto_reply: "on", tone_notes: "friendly" }));
    const c = await toggleAutoReply(false);
    expect([a.ok, b.ok, c.ok]).toEqual([true, true, true]);
    expect(db._db.businesses[0]).toMatchObject({ wa_phone_number_id: "TEST_PHONE_NUMBER_ID", tone_notes: "friendly", auto_reply: false });
  });
});

describe("connectWhatsAppEmbedded", () => {
  const input = { code: "one-time-code-123", wabaId: "222222222", phoneNumberId: "999888777666555" };
  type Call = { url: string; init: RequestInit };
  let calls: Call[];

  /** A fake Graph API. `overrides` changes the status of one step: exchange, access, subscribe or register. */
  function graph(overrides: Partial<Record<"exchange" | "access" | "subscribe" | "register", number>> = {}) {
    calls = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit = {}) => {
        calls.push({ url, init });
        const step = url.includes("/oauth/access_token")
          ? "exchange"
          : url.includes("/subscribed_apps")
            ? "subscribe"
            : url.includes("/register")
              ? "register"
              : "access";
        const status = overrides[step] ?? 200;
        const body = step === "exchange" ? { access_token: "business-token" } : step === "access" ? { id: input.phoneNumberId } : { success: true };
        return new Response(JSON.stringify(status === 200 ? body : { error: {} }), { status });
      }),
    );
  }
  const steps = () => calls.map((c) => (c.url.includes("oauth") ? "exchange" : c.url.includes("subscribed_apps") ? "subscribe" : c.url.includes("/register") ? "register" : "access"));
  const biz = () => db._db.businesses[0];

  beforeEach(() => {
    process.env.NEXT_PUBLIC_META_APP_ID = "app-1";
    process.env.NEXT_PUBLIC_META_ES_CONFIG_ID = "cfg-1";
    process.env.WHATSAPP_APP_SECRET = "deployment-secret";
    process.env.WA_SECRETS_KEY = Buffer.alloc(32, 7).toString("base64");
  });
  afterEach(() => {
    for (const k of ["NEXT_PUBLIC_META_APP_ID", "NEXT_PUBLIC_META_ES_CONFIG_ID", "WHATSAPP_APP_SECRET", "WA_SECRETS_KEY"]) delete process.env[k];
  });

  it("connects the number: exchange, check access, subscribe, register, then save", async () => {
    graph();
    const res = await connectWhatsAppEmbedded(input);
    expect(res.error).toBeUndefined();
    expect(res.ok).toBe(true);
    expect(steps()).toEqual(["exchange", "access", "subscribe", "register"]);
    // The later calls use the business token from the exchange.
    for (const c of calls.slice(1)) expect(c.init.headers).toMatchObject({ authorization: "Bearer business-token" });
    expect(JSON.parse(String(calls[3].init.body)).pin).toMatch(/^\d{6}$/);

    expect(biz()).toMatchObject({ wa_phone_number_id: input.phoneNumberId, wa_waba_id: input.wabaId, wa_connection_type: "embedded", wa_app_secret: null, wa_verify_token: null });
    expect(String(biz().wa_access_token)).toMatch(/^enc:v1:/);
    expect(String(biz().wa_register_pin)).toMatch(/^enc:v1:/);
    expect(JSON.stringify(biz())).not.toContain("business-token");
  });

  it("moves a business that brought its own Meta app onto the deployment's app", async () => {
    db._db.businesses[0].wa_app_secret = "enc-old-secret";
    db._db.businesses[0].wa_verify_token = "old-verify";
    graph();
    await connectWhatsAppEmbedded(input);
    expect(biz().wa_app_secret).toBeNull();
    expect(biz().wa_verify_token).toBeNull();
  });

  it("does not save a number the new token cannot see", async () => {
    graph({ access: 400 });
    const res = await connectWhatsAppEmbedded(input);
    expect(res.error).toBeTruthy();
    expect(steps()).toEqual(["exchange", "access"]);
    expect(biz().wa_phone_number_id).toBe("123456789012345");
    expect(biz().wa_connection_type ?? "manual").toBe("manual");
  });

  it("stops at the first step that fails and saves nothing", async () => {
    for (const [fail, ran] of [
      ["exchange", ["exchange"]],
      ["subscribe", ["exchange", "access", "subscribe"]],
      ["register", ["exchange", "access", "subscribe", "register"]],
    ] as const) {
      seed();
      graph({ [fail]: 400 });
      const res = await connectWhatsAppEmbedded(input);
      expect(res.error).toBeTruthy();
      expect(steps()).toEqual(ran);
      expect(biz().wa_phone_number_id).toBe("123456789012345");
    }
  });

  it("rejects malformed input without calling Meta", async () => {
    graph();
    expect((await connectWhatsAppEmbedded({ ...input, phoneNumberId: "../evil" })).error).toBeTruthy();
    expect((await connectWhatsAppEmbedded({ ...input, wabaId: "12 34" })).error).toBeTruthy();
    expect((await connectWhatsAppEmbedded({ ...input, code: "" })).error).toBeTruthy();
    expect(calls).toHaveLength(0);
  });

  it("says so when the deployment is not set up for it, without calling Meta", async () => {
    delete process.env.NEXT_PUBLIC_META_ES_CONFIG_ID;
    graph();
    expect((await connectWhatsAppEmbedded(input)).error).toMatch(/not set up/i);
    expect(calls).toHaveLength(0);
  });

  it("does not spend the one-time code when credentials cannot be stored safely", async () => {
    vi.stubEnv("NODE_ENV", "production");
    delete process.env.WA_SECRETS_KEY;
    graph();
    try {
      expect((await connectWhatsAppEmbedded(input)).error).toMatch(/WA_SECRETS_KEY/);
      expect(calls).toHaveLength(0);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("reuses the saved PIN when the same number is connected again", async () => {
    graph();
    await connectWhatsAppEmbedded(input);
    const firstPin = JSON.parse(String(calls[3].init.body)).pin;
    graph();
    await connectWhatsAppEmbedded(input);
    expect(JSON.parse(String(calls[3].init.body)).pin).toBe(firstPin);
  });

  it("reports a number that another business already has", async () => {
    db._db.businesses.push({ id: "biz-2", owner_id: "owner-2", name: "Other", wa_phone_number_id: input.phoneNumberId });
    graph();
    expect((await connectWhatsAppEmbedded(input)).error).toMatch(/already connected/i);
    // It stops before subscribing the WABA, so a refused claim never leaves webhooks flowing to the other row.
    expect(steps()).toEqual(["exchange", "access"]);
  });
});

describe("saving the connect form for a business connected through Embedded Signup", () => {
  const embeddedBiz = () => {
    Object.assign(db._db.businesses[0], { wa_connection_type: "embedded", wa_waba_id: "222222222", wa_access_token: "enc-token", wa_register_pin: "enc-pin" });
  };

  it("lets the owner change other details without asking for an app secret", async () => {
    embeddedBiz();
    const res = await saveWhatsAppConnection(noState, form({ wa_phone_number_id: "123456789012345", wa_owner_number: "60123456789" }));
    expect(res.error).toBeUndefined();
    expect(db._db.businesses[0]).toMatchObject({ wa_owner_number: "60123456789", wa_connection_type: "embedded", wa_waba_id: "222222222" });
  });

  it("switches to the bring-your-own-app setup when the owner enters credentials of their own", async () => {
    embeddedBiz();
    const res = await saveWhatsAppConnection(
      noState,
      form({ wa_phone_number_id: "123456789012345", wa_app_secret: "my-secret", wa_access_token: "my-token" }),
    );
    expect(res.error).toBeUndefined();
    expect(db._db.businesses[0]).toMatchObject({ wa_connection_type: "manual", wa_waba_id: null, wa_register_pin: null });
  });

  it("still refuses a different number with no credentials to match", async () => {
    embeddedBiz();
    const res = await saveWhatsAppConnection(noState, form({ wa_phone_number_id: "555666777888999" }));
    expect(res.error).toMatch(/app secret/i);
    expect(db._db.businesses[0].wa_phone_number_id).toBe("123456789012345");
  });
});
