# WhatsApp Sales CRM (Vici) setup

## 1. Supabase (free tier)
1. supabase.com > organization "Vici" > New project (Singapore region).
2. SQL Editor > run `supabase/migrations/0001_init.sql`, then `0002_quote_and_locks.sql`, then `0003_pending_decision.sql`, then `0004_auto_reply.sql`, then `0005_handoff_note.sql`, then `0006_order_flow.sql`. Run each file once, in order. If you see "already exists", that file was already run, so skip it.
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
npm i @supabase/supabase-js @supabase/ssr @anthropic-ai/sdk lucide-react class-variance-authority clsx tailwind-merge sonner tw-animate-css @radix-ui/react-select @radix-ui/react-dialog @radix-ui/react-switch @radix-ui/react-slot @radix-ui/react-label @radix-ui/react-tabs
npm run dev
```
Restart the dev server after changing `.env.local`. Open http://localhost:3000 and sign in.

## 4. Test without WhatsApp
```bash
node --env-file=.env.local scripts/simulate-webhook.mjs "Hi kak, nak order kek birthday 2 tier untuk 28 Sept, budget around RM200" in
node --env-file=.env.local scripts/simulate-webhook.mjs "Boleh kak! 2 tier RM220 ya, cukup untuk 20 orang" out
node --env-file=.env.local scripts/simulate-webhook.mjs "Okay nanti saya confirm" in
```
The lead appears on the board. With the assistant on, it answers the customer itself. Chats it cannot decide alone (a discount, a payment to check, something it is not sure about) show at the top of the dashboard as "needs you".

## 5. Automatic replies (test mode)
1. Dashboard > "Assistant: off" > tick "Answer customers automatically" and fill in "What the assistant may say" (prices, delivery, hours, how to pay). Put your bank details in the separate "Payment details" box (not in the facts). Save.
2. Send customer messages with the simulator. The assistant answers, or hands the chat to you for a discount, stock or availability, a payment, or anything it is not sure about. Handed-over chats show "Needs you" at the top of the dashboard.
3. Replies are saved in the conversation but NOT sent to WhatsApp until you set `WHATSAPP_SEND_MODE=live` and `WHATSAPP_ACCESS_TOKEN`.
4. Without an AI key it runs a simple keyword stand-in, which is enough to test the flow.

Try these (same customer number):
```bash
node --env-file=.env.local scripts/simulate-webhook.mjs "Hi, ada cupcake tak?" in
node --env-file=.env.local scripts/simulate-webhook.mjs "Boleh kurang sikit tak?" in
node --env-file=.env.local scripts/simulate-webhook.mjs "" image
```

## 6. Connect real WhatsApp later
Meta developer app > WhatsApp > callback URL `https://YOUR-URL/api/whatsapp/webhook`, verify token = `WHATSAPP_VERIFY_TOKEN`, subscribe to `messages` (and `smb_message_echoes` for coexistence numbers). Put the real app secret in `WHATSAPP_APP_SECRET` and the real phone number id in your business row.
