-- 0010_per_business_wa_credentials.sql
-- Lets each business bring its own Meta app credentials instead of sharing one deployment-wide
-- WHATSAPP_ACCESS_TOKEN / WHATSAPP_APP_SECRET / WHATSAPP_VERIFY_TOKEN. All three stay optional:
-- a business with none of these set falls back to the deployment's shared env vars, so existing
-- single-business setups keep working unchanged.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='businesses' AND column_name='wa_access_token') THEN
    ALTER TABLE public.businesses ADD COLUMN wa_access_token text;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='businesses' AND column_name='wa_app_secret') THEN
    ALTER TABLE public.businesses ADD COLUMN wa_app_secret text;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='businesses' AND column_name='wa_verify_token') THEN
    ALTER TABLE public.businesses ADD COLUMN wa_verify_token text;
  END IF;
END $$;

-- A verify token, if a business sets one, must be unique: the GET handshake looks a token up
-- with no other context, so two businesses sharing one value would be ambiguous.
create unique index if not exists businesses_wa_verify_token_key on public.businesses (wa_verify_token)
  where wa_verify_token is not null;
