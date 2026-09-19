# WhatsApp Sales CRM (Vici) setup

## 1. Supabase (free tier)
1. supabase.com > organization "Vici" > New project (Singapore region).
2. SQL Editor > run `supabase/migrations/0001_init.sql`, then `0002_quote_and_locks.sql`. Run each file once, in order. If you see "already exists", that file was already run, so skip it.
3. Authentication > Users > Add user (your email + a password). Copy the user id.
4. Insert your business row:

```sql
insert into businesses (owner_id, name, wa_phone_number_id, wa_owner_number)
values ('YOUR-USER-ID', 'Test Bakery', 'TEST_PHONE_NUMBER_ID', '60123456789');
```

5. Settings > API Keys: put the URL, publishable key and secret key in `.env.local` (names are in `.env.example`).

## 2. Free AI (optional, mock mode works without it)
1. Get a key at aistudio.google.com (no credit card).
2. In `.env.local` set `AI_API_KEY` and `AI_MODEL` (a Flash-Lite model id from AI Studio has the biggest free daily allowance).
3. Use fake test chats only. Google may use free-tier data to improve its models.

## 3. Run
```bash
npm i @supabase/supabase-js @supabase/ssr @anthropic-ai/sdk
npm run dev
```
Restart the dev server after changing `.env.local`. Open http://localhost:3000 and sign in.

## 4. Test without WhatsApp
```bash
node --env-file=.env.local scripts/simulate-webhook.mjs "Hi kak, nak order kek birthday 2 tier untuk 28 Sept, budget around RM200" in
node --env-file=.env.local scripts/simulate-webhook.mjs "Boleh kak! 2 tier RM220 ya, cukup untuk 20 orang" out
node --env-file=.env.local scripts/simulate-webhook.mjs "Okay nanti saya confirm" in
```
To make the lead show under "Leads to chase", back-date it (SQL Editor):

```sql
update leads set last_message_at = now() - interval '4 days'
where wa_contact_number = '60123456789';
```

## 5. Connect real WhatsApp later
Meta developer app > WhatsApp > callback URL `https://YOUR-URL/api/whatsapp/webhook`, verify token = `WHATSAPP_VERIFY_TOKEN`, subscribe to `messages` (and `smb_message_echoes` for coexistence numbers). Put the real app secret in `WHATSAPP_APP_SECRET` and the real phone number id in your business row.
