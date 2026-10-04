# WhatsApp Sales CRM (Vici) setup

## 1. Supabase (free tier)
1. supabase.com > organization "Vici" > New project (Singapore region).
2. SQL Editor > run `supabase/migrations/0001_init.sql`, then `0002_quote_and_locks.sql`, then `0003_pending_decision.sql`, then `0004_auto_reply.sql`, then `0005_handoff_note.sql`, then `0006_order_flow.sql`, then `0007_follow_ups.sql`, then `0008_knowledge_base.sql`, then `0009_self_serve_signup.sql`, then `0010_per_business_wa_credentials.sql`, then `0011_reply_mode.sql`, then `0012_billing.sql`, then `0013_knowledge_documents.sql`, then `0014_last_messages.sql`, then `0015_reliability.sql`, then `0016_scale_and_stats.sql`. Run each file once, in order. If you see "already exists", that file was already run, so skip it.
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
This is the script to use until real WhatsApp is connected. It needs `WHATSAPP_APP_SECRET` in `.env.local` (any value, for example `simulator-secret`), the app running with `pnpm dev`, and a business whose WhatsApp phone number ID in Settings is `TEST_PHONE_NUMBER_ID`. If the script prints a status other than `200 ok`, read the terminal where `pnpm dev` is running: the first error line names what is missing (a migration that was not run, a wrong secret, or no business with that phone number ID). `scripts/test-db.sh` is a different, optional tool for developers: it needs bash and the `psql` client and builds its own throwaway database, so you do not need it to try the app.
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
Dashboard > Knowledge base. Add entries under Menu and pricing, Location and delivery, Hours and lead time, Policies, and FAQ. An empty knowledge base shows a "Fill with an example" button that adds a starter set you can edit. The "Preview" button shows exactly what gets sent to the AI. The **PDF files** tab lets you upload a PDF of your business data (price list, menu, catalogue; text PDFs only, up to 4MB, up to 5 files). The text is extracted on the server and only that text is stored, so no Supabase Storage bucket is needed. It is added to what the assistant reads, and shows in Preview. Each PDF is cut to 20,000 characters and all PDFs together to 40,000, to keep prompts small for the free model. Needs migration 0013. This replaces the old single "What the assistant may say" box; if you had text there already, it now appears under the Other tab, unchanged.

## 7. After-sale follow-ups
Dashboard > Follow-ups > Automations: turn on "Ask for feedback" and/or "Remind them to reorder", set the days, and (for real sending) the WhatsApp template names. Add your review link.
1. An order's follow-ups are queued when you click **Payment received**. That message also asks the customer to reply YA to agree to follow-ups. STOP always opts them out.
2. Follow-ups only go to customers who agreed. You can also switch it on in a customer's Details.
3. Test in test mode: click Payment received, reply YA as the customer with the simulator, then open Follow-ups > Queue and click "Send now". Reply with a rating (for example "5 sedap!") and the feedback appears under Feedback.
4. A daily job sends due follow-ups at 10am Malaysia time. On Vercel it is configured in `vercel.json` (set `CRON_SECRET` in the project's environment variables). While testing locally, use the "Send what is due" button.

**Prices and order totals (migration 0015).** Menu, location and policy entries have an optional **Price (RM)** field. Give each thing you sell a fixed price there (and the delivery fee, if it is a flat fee). The preview then shows each priced item with a code such as `[P1]`. The assistant only says which items and how many; the server prices the order, writes the total into the reply, and saves the lines and total on the order (`order_lines`, `order_total_myr`). Dashboard revenue uses that total. The assistant can no longer state an amount that is not on your menu, not from the customer, and not computed: such a reply is held back and the chat goes to you. The codes (`[P1]`) are only for the assistant: they are removed from anything a customer reads, and the Preview in the Knowledge base shows the same text the assistant reads, codes included. A chat that was handed to you stays handed to you after you change a setting or a menu entry: nothing re-runs the old message. Press "I already answered on WhatsApp" (or answer it) to let the assistant take over again, then send a new message. A business with no priced items keeps the older, looser price check and gets no computed totals, so fill in prices. Limits: a title is 150 characters, details 2,000, the other-notes box 5,000, 300 entries, and typed text sent to the AI is capped at 30,000 characters in total.

## 8. Connect real WhatsApp later
Dashboard > Settings > "Connect WhatsApp" shows your webhook URL and lets you save the phone number ID from the dashboard instead of editing the database directly. You still need to, in your Meta developer app > WhatsApp > Configuration: paste that callback URL, set a verify token, and subscribe to `messages` (and `smb_message_echoes` for coexistence numbers). Set `WHATSAPP_SEND_MODE=live` on the deployment to actually send messages.

There are two ways to hold the credentials (verify token, app secret, access token):
- **Shared** (default, simplest for one operator running several small businesses under one Meta app): set `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET`, and `WHATSAPP_ACCESS_TOKEN` once as deployment environment variables. Every business without its own credentials uses these.
- **Per-business** (each business brings its own Meta app/WABA): in "Connect WhatsApp", fill in that business's own verify token, app secret, and access token. That business's messages are then signed, verified, and sent using only its own credentials — never the shared ones, and never visible to any other business.

A business can mix and match (e.g. its own access token but the shared verify token). Whichever the webhook payload's phone number ID resolves to is what gets used, checked before the shared default.

**How incoming messages are verified.** Every phone number ID in a webhook delivery must verify against that business's own app secret (or the shared secret, for a business with no credentials of its own). A business that saves its own access token or verify token must also save its own app secret; Settings refuses the half-set-up state, and the webhook rejects it, because nothing could then prove a message came from Meta.

**How a number is claimed.** In live mode (`WHATSAPP_SEND_MODE=live`), saving a phone number ID makes a Graph API call with that business's access token (or the shared one) and only saves the number if WhatsApp confirms the token can see it. In test mode this check is skipped, so the simulator keeps working with IDs like `TEST_PHONE_NUMBER_ID`. One limit remains: on the shared token, any number under the shared WhatsApp Business Account passes the check, so first come first served applies to numbers on that account.

**Opt-out and consent.** Only a message that is just `STOP`, `unsubscribe`, `berhenti` or `henti` (plus a filler word such as "please") switches follow-ups off. `batal` means "cancel" in Malay, so it goes to the order assistant instead. Marketing consent needs an explicit `YA`, `YES` or `SETUJU` sent straight after the follow-up offer.

**Credentials are encrypted.** The access token and app secret are stored as AES-256-GCM ciphertext, so a stolen browser session cannot read them. Set `WA_SECRETS_KEY` on the deployment to 32 random bytes (generate one with `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`) **before** anyone saves credentials; in production, saving fails without it. Keep a copy of the key somewhere safe: if it is lost, the saved tokens cannot be recovered and each business must enter them again. To encrypt credentials saved before this change, run `WA_SECRETS_KEY=... NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/encrypt-existing-secrets.mjs --dry-run`, then again without `--dry-run`. It is safe to repeat. Until it runs, old plaintext values keep working. The verify token stays readable because Meta sends it in the clear during setup.

**The inbound queue.** The webhook now stores each message and queues a job (`inbound_jobs`), answers Meta, and then works the queue in the background: AI reply, sending, lead update. If a worker crashes or times out, the job is retried after 30 seconds, 2, 8 and 30 minutes, five attempts in all. After that the chat is flagged "Needs you" with a note, so a customer is never left unanswered without you knowing. A second message from a customer while a job is waiting joins it, and the database allows only one running job per chat, so one customer never gets two replies. If migration 0015 has not been run yet, the webhook still works: it answers each message directly with no retries and logs a warning that names the missing table, so the simulator and a new setup are never blocked by it. Retries are triggered by the next incoming message, and by `/api/cron/inbound-jobs` (daily in `vercel.json`, which is all Vercel's free Hobby plan allows). On a plan that allows it, change that schedule to `* * * * *` so a retry never waits for the next message.

**Outbound calls.** Every call to WhatsApp and to the AI provider has a timeout. AI calls retry once. A WhatsApp send is retried only after a 429 (the API has no idempotency key, so retrying a timeout could message a customer twice). The routes set `maxDuration = 60`; the free Hobby plan may cap this lower.


## Operating it

**Logs and alerts.** Server logs are one JSON object per line (`lib/log.ts`) with an `event` name and IDs such as `leadId` and `jobId`, never message text, phone numbers or tokens. Filter or alert on `event` in your log drain. `LOG_LEVEL` sets the minimum level (default `info`). Set `ALERT_WEBHOOK_URL` to a Slack or Discord incoming webhook (anything that accepts `{"text": "..."}`) to be messaged when a customer message could not be processed after all retries, or a follow-up has been stuck sending. Without it the same events are only logged. Alerts are rate limited to one per kind per 10 minutes, and a failing alert endpoint never breaks the work that raised it.

**Dashboard numbers and search (migration 0016).** The overview figures are computed in the database (`dashboard_stats`), so they stay correct however many messages there are, and message search uses a trigram index. Both fall back to the older code paths if 0016 has not run yet.

**Database types.** `lib/db-types.ts` is generated from the migrations, so a query that names a column that does not exist fails `tsc` instead of failing in production. After adding a migration, run `scripts/test-db.sh` against a local Postgres, then `DATABASE_URL=postgres://postgres:postgres@localhost:5432/crm_test node scripts/gen-db-types.mjs`, and commit the result. CI runs the same check and fails if the file is stale. Only the Supabase clients made by `createClient()` and `createAdminClient()` are typed; helper functions that take a plain `SupabaseClient` are still unchecked.

**Database tests.** `DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres scripts/test-db.sh` builds a throwaway database, runs every migration (twice, to prove they are safe to repeat), and then runs `supabase/tests/*.sql`: that one business can never read or change another's data (row level security), the job queue rules, and the dashboard numbers. It needs the `psql` client and must never be pointed at a real project. CI runs it on every push.

**Where the code is.** `lib/whatsapp/` holds the WhatsApp flow in small files (`ingest.ts` is the webhook's half, `worker.ts` the queue worker's half, `agent.ts` the assistant, `billing-gate.ts`, `followup-replies.ts`, `lead.ts`, `messaging.ts`, `replies.ts`, `signature.ts`, `types.ts`), and `@/lib/whatsapp` re-exports the public parts. The dashboard's server actions are in `app/dashboard/actions/` by topic (`leads`, `settings`, `replies`, `messages`); `shared.ts` there holds what they have in common and is not itself a set of actions.

## Checks

`pnpm run lint`, `pnpm exec tsc --noEmit`, `pnpm test` and `pnpm audit --prod --audit-level high` run on every push and pull request (`.github/workflows/ci.yml`). The project uses pnpm; `pnpm-lock.yaml` is the only lockfile, so do not commit a `package-lock.json`.

## 9. Billing (Stripe)
Every business, new or existing, gets a 14 day free trial with no card needed. When the trial ends (or a payment fails, or the subscription is cancelled) the assistant stops: it does not reply, draft, extract lead details, or send follow-ups, and each new chat is flagged "subscription needs attention". Customer messages still arrive and the owner can answer by hand. STOP is always honoured.

To take payments:
1. dashboard.stripe.com (start in **test mode**) > Product catalog > add one product with a recurring price. Copy the price id (`price_...`).
2. Developers > API keys: copy the secret key.
3. Settings > Billing > Customer portal: turn it on (this is what the "Manage billing" button opens).
4. Developers > Webhooks > add an endpoint `https://YOUR-DOMAIN/api/stripe/webhook`, and send these events: `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`. Copy the signing secret (`whsec_...`).
5. Set on the deployment (and in `.env.local`):
   - `STRIPE_SECRET_KEY`
   - `STRIPE_PRICE_ID`
   - `STRIPE_WEBHOOK_SECRET`
   - `NEXT_PUBLIC_APP_URL` (for example `https://yourapp.vercel.app`, used for the return links after checkout)

Without the first two, the Billing page says billing is not set up and the Subscribe button is disabled. The trial and the pause still work.

Test locally: run `stripe listen --forward-to localhost:3000/api/stripe/webhook`, use its `whsec_...` as `STRIPE_WEBHOOK_SECRET`, then check out with card `4242 4242 4242 4242`. To test the pause without waiting 14 days, set the `subscriptions.trial_ends_at` for your business to a past date in the Supabase table editor (status `trialing`).

After checkout, the app asks Stripe directly what happened (`/dashboard/billing/return`), so the Billing page is right straight away even if the webhook hasn't arrived, or isn't running locally. The webhook is still what keeps things correct afterwards: renewals, failed payments, and cancellations only reach the app through it, so it must be set up before you go live.

Note: the trial is tracked by this app, not by Stripe. Subscribing charges immediately; it does not carry over remaining trial days.
