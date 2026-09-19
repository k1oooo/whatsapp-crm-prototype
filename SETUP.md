# WhatsApp Sales CRM (Vici)

Next.js + Supabase + WhatsApp Cloud API + Claude. Reads WhatsApp chats, builds lead cards, flags cold leads, drafts follow-ups.

## 1. Supabase setup (free tier)

1. supabase.com > New organization "Vici" > New project (pick the Singapore region for lowest latency from Malaysia).
2. SQL Editor > paste `supabase/migrations/0001_init.sql` > Run.
3. Project Settings > API: copy the project URL, anon key and service role key.
4. Authentication > Users > Add user (your own email). Copy that user's id.
5. Create your business row (SQL Editor), using your user id:

```sql
insert into businesses (owner_id, name, wa_phone_number_id, wa_owner_number)
values ('YOUR-USER-ID', 'Test Bakery', 'TEST_PHONE_NUMBER_ID', '60123456789');
```

`wa_phone_number_id` must match the phone number id Meta sends. For the simulator use `TEST_PHONE_NUMBER_ID`. Later, replace it with the real id from the Meta dashboard.

## 2. Run locally

```bash
cp .env.example .env.local   # fill in the Supabase keys, set WHATSAPP_APP_SECRET to any string for now
npm i @supabase/supabase-js @supabase/ssr @anthropic-ai/sdk
npm run dev
```

## 3. Test without WhatsApp (free)

In another terminal:

```bash
node --env-file=.env.local scripts/simulate-webhook.mjs "Hi kak, ada buat kek birthday tak?" in
node --env-file=.env.local scripts/simulate-webhook.mjs "Ada! Untuk berapa orang?" out
```

Then check the `leads` and `messages` tables in Supabase. With no `ANTHROPIC_API_KEY`, extraction runs in mock mode. Add the key to use real extraction (Haiku, a few cents for testing).

## 4. Connect real WhatsApp (when ready)

1. Meta developer app > add WhatsApp > note the phone number id and app secret.
2. Expose your dev server (`cloudflared tunnel --url http://localhost:3000`) or deploy to Vercel.
3. In the Meta dashboard set the callback URL to `https://YOUR-URL/api/whatsapp/webhook` and the verify token to `WHATSAPP_VERIFY_TOKEN`. Subscribe to `messages` (and `smb_message_echoes` for coexistence numbers).
4. Set `WHATSAPP_APP_SECRET` to the real app secret and update the business row's `wa_phone_number_id`.

## Layout

- `supabase/migrations/` database schema (add new numbered files for every change)
- `lib/ai.ts` lead extraction and follow-up drafts (mock mode without an API key)
- `lib/whatsapp.ts` signature check and message ingestion
- `lib/supabase/` admin (server only), browser and server clients
- `app/api/whatsapp/webhook/route.ts` Meta webhook
