# WhatsApp Sales CRM (Vici) setup

## 1. Supabase (free tier)
1. supabase.com > organization "Vici" > New project (Singapore region).
2. SQL Editor > run `supabase/migrations/0001_init.sql`, then `0002_quote_and_locks.sql`, then `0003_pending_decision.sql`, then `0004_auto_reply.sql`, then `0005_handoff_note.sql`, then `0006_order_flow.sql`, then `0007_follow_ups.sql`, then `0008_knowledge_base.sql`, then `0009_self_serve_signup.sql`, then `0010_per_business_wa_credentials.sql`. Run each file once, in order. If you see "already exists", that file was already run, so skip it.
3. Settings > API Keys: put the URL, publishable key and secret key in `.env.local` (names are in `.env.example`).
4. Open the app, go to `/signup`, and create your account with your business name. The business row and dashboard are created for you — no SQL Editor step needed. (Auth > Providers > Email: if "Confirm email" is on, you'll get a confirmation link first; the business is still created the first time you land on the dashboard.)

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

## 6. Knowledge base
Dashboard > Knowledge base. Add entries under Menu and pricing, Location and delivery, Hours and lead time, Policies, and FAQ. An empty knowledge base shows a "Fill with an example" button that adds a starter set you can edit. The "Preview" button shows exactly what gets sent to the AI. This replaces the old single "What the assistant may say" box; if you had text there already, it now appears under the Other tab, unchanged.

## 7. After-sale follow-ups
Dashboard > Follow-ups > Automations: turn on "Ask for feedback" and/or "Remind them to reorder", set the days, and (for real sending) the WhatsApp template names. Add your review link.
1. An order's follow-ups are queued when you click **Payment received**. That message also asks the customer to reply YA to agree to follow-ups. STOP always opts them out.
2. Follow-ups only go to customers who agreed. You can also switch it on in a customer's Details.
3. Test in test mode: click Payment received, reply YA as the customer with the simulator, then open Follow-ups > Queue and click "Send now". Reply with a rating (for example "5 sedap!") and the feedback appears under Feedback.
4. A daily job sends due follow-ups at 10am Malaysia time. On Vercel it is configured in `vercel.json` (set `CRON_SECRET` in the project's environment variables). While testing locally, use the "Send what is due" button.

## 8. Connect real WhatsApp later
Dashboard > Settings > "Connect WhatsApp" shows your webhook URL and lets you save the phone number ID from the dashboard instead of editing the database directly. You still need to, in your Meta developer app > WhatsApp > Configuration: paste that callback URL, set a verify token, and subscribe to `messages` (and `smb_message_echoes` for coexistence numbers). Set `WHATSAPP_SEND_MODE=live` on the deployment to actually send messages.

There are two ways to hold the credentials (verify token, app secret, access token):
- **Shared** (default, simplest for one operator running several small businesses under one Meta app): set `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET`, and `WHATSAPP_ACCESS_TOKEN` once as deployment environment variables. Every business without its own credentials uses these.
- **Per-business** (each business brings its own Meta app/WABA): in "Connect WhatsApp", fill in that business's own verify token, app secret, and access token. That business's messages are then signed, verified, and sent using only its own credentials — never the shared ones, and never visible to any other business.

A business can mix and match (e.g. its own access token but the shared verify token). Whichever the webhook payload's phone number ID resolves to is what gets used, checked before the shared default.
