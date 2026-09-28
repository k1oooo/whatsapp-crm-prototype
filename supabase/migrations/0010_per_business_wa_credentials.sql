-- 0010_per_business_wa_credentials.sql
-- Lets each business bring its own Meta app credentials instead of the deployment-wide
-- WHATSAPP_ACCESS_TOKEN / WHATSAPP_APP_SECRET / WHATSAPP_VERIFY_TOKEN. All three stay optional:
-- a business with none set falls back to the shared env vars.

alter table public.businesses
  add column if not exists wa_access_token text,
  add column if not exists wa_app_secret text,
  add column if not exists wa_verify_token text;

-- A verify token, if set, must be unique: the GET handshake looks a token up with no other
-- context, so two businesses sharing one value would be ambiguous.
create unique index if not exists businesses_wa_verify_token_key on public.businesses (wa_verify_token)
  where wa_verify_token is not null;

notify pgrst, 'reload schema';
