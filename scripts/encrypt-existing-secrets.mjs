// One-off: encrypts the WhatsApp access tokens and app secrets that were saved as plaintext before
// credentials were encrypted at rest. Safe to run more than once: values that are already encrypted
// are skipped.
//
//   WA_SECRETS_KEY=<32 bytes, base64 or 64 hex> \
//   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
//   node scripts/encrypt-existing-secrets.mjs [--dry-run]
//
// Generate a key with:  node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const PREFIX = "enc:v1:";
const dryRun = process.argv.includes("--dry-run");

const raw = process.env.WA_SECRETS_KEY?.trim();
const key = raw ? (/^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64")) : null;
if (!key || key.length !== 32) {
  console.error("WA_SECRETS_KEY must be set to 32 bytes (base64 or 64 hex characters).");
  process.exit(1);
}

function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return PREFIX + [iv, cipher.getAuthTag(), ct].map((b) => b.toString("base64url")).join(":");
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}
const db = createClient(url, serviceKey, { auth: { persistSession: false } });

const { data: rows, error } = await db.from("businesses").select("id, wa_access_token, wa_app_secret");
if (error) {
  console.error("Could not read businesses:", error.message);
  process.exit(1);
}

let changed = 0;
for (const row of rows) {
  const update = {};
  for (const col of ["wa_access_token", "wa_app_secret"]) {
    const v = row[col];
    if (v && !v.startsWith(PREFIX)) update[col] = encrypt(v);
  }
  if (Object.keys(update).length === 0) continue;
  changed++;
  if (dryRun) {
    console.log(`would encrypt ${Object.keys(update).join(", ")} for business ${row.id}`);
    continue;
  }
  const { error: upError } = await db.from("businesses").update(update).eq("id", row.id);
  if (upError) {
    console.error(`FAILED for business ${row.id}:`, upError.message);
    process.exitCode = 1;
  } else {
    console.log(`encrypted ${Object.keys(update).join(", ")} for business ${row.id}`);
  }
}
console.log(`${dryRun ? "Would change" : "Changed"} ${changed} of ${rows.length} businesses.`);
