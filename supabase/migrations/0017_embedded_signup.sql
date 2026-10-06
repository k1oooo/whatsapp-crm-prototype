-- 0017_embedded_signup.sql
-- Embedded Signup: a business connects its WhatsApp number through a Meta popup run by this
-- deployment's own Meta app (the Tech Provider model), instead of pasting credentials from an app
-- of its own.
--
--   wa_connection_type  'manual'   = the business brought its own Meta app credentials (migration
--                                    0010), or none and uses the shared deployment token.
--                       'embedded' = connected through Embedded Signup. wa_access_token is a business
--                                    token for this deployment's Meta app, so Meta signs webhooks
--                                    with the deployment's WHATSAPP_APP_SECRET, not a per-business one.
--   wa_waba_id          the business's WhatsApp Business Account, returned by Embedded Signup.
--   wa_register_pin     the two-step verification PIN set when the number was registered with the
--                       Cloud API. Stored encrypted by the app (see lib/secrets.ts).

alter table public.businesses
  add column if not exists wa_connection_type text not null default 'manual',
  add column if not exists wa_waba_id text,
  add column if not exists wa_register_pin text;

do $$
begin
  alter table public.businesses
    add constraint businesses_wa_connection_type_check
    check (wa_connection_type in ('manual', 'embedded'));
exception when duplicate_object then null;
end $$;

notify pgrst, 'reload schema';
