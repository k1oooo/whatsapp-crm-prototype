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

import { confirmPayment, saveWhatsAppConnection, sendDraftReply } from "@/app/dashboard/actions";

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

  it("verifies against the shared token when the business brings none", async () => {
    live();
    const f = vi.fn(async () => new Response(JSON.stringify({ id: "999888777666555" }), { status: 200 }));
    vi.stubGlobal("fetch", f);
    await saveWhatsAppConnection(noState, form({ wa_phone_number_id: "999888777666555" }));
    expect((f.mock.calls[0] as unknown as [string, RequestInit])[1].headers).toMatchObject({ authorization: "Bearer shared-token" });
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
