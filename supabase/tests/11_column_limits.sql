-- Owners reach the database straight from the browser, so row level security is not enough: they must
-- also be unable to write the columns only the server may set (the WhatsApp connection, a lead's phone
-- number, which lead a follow-up points at). Run by scripts/test-db.sh.
\set ON_ERROR_STOP on

insert into auth.users (id) values ('00000000-0000-0000-0000-0000000000e1'), ('00000000-0000-0000-0000-0000000000e2');
insert into public.businesses (id, owner_id, name, wa_phone_number_id) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000e1', 'E1', '9001'),
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000e2', 'E2', '9002');
insert into public.leads (id, business_id, wa_contact_number, name) values
  ('00000000-0000-0000-0000-0000000000a9', '00000000-0000-0000-0000-0000000000f1', '6011', 'E1 lead'),
  ('00000000-0000-0000-0000-0000000000b9', '00000000-0000-0000-0000-0000000000f2', '7011', 'E2 lead');
insert into public.follow_ups (id, business_id, lead_id, kind, due_at) values
  ('00000000-0000-0000-0000-0000000000c9', '00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000a9', 'feedback', now());

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000e1', true) as _ \gset

do $$
declare n int;
begin
  -- columns the app lets an owner edit still work
  update public.businesses set name = 'E1 renamed', auto_reply = false, tone_notes = 'friendly' where id = '00000000-0000-0000-0000-0000000000f1';
  get diagnostics n = row_count; assert n = 1, 'owner can edit their business settings';
  update public.leads set stage = 'won', name = 'E1 edited', order_status = 'paid', awaiting_feedback = true where id = '00000000-0000-0000-0000-0000000000a9';
  get diagnostics n = row_count; assert n = 1, 'owner can edit lead fields the dashboard uses';
  update public.follow_ups set status = 'skipped', detail = 'skipped by owner' where id = '00000000-0000-0000-0000-0000000000c9';
  get diagnostics n = row_count; assert n = 1, 'owner can skip a follow-up';

  -- the WhatsApp connection can not be written from the browser, whatever the value
  begin
    update public.businesses set wa_phone_number_id = '9002' where id = '00000000-0000-0000-0000-0000000000f1';
    raise exception 'owner changed wa_phone_number_id directly';
  exception when insufficient_privilege then null; end;
  begin
    update public.businesses set wa_connection_type = 'embedded' where id = '00000000-0000-0000-0000-0000000000f1';
    raise exception 'owner changed wa_connection_type directly';
  exception when insufficient_privilege then null; end;
  begin
    update public.businesses set wa_access_token = 'x', wa_app_secret = 'x', wa_verify_token = 'x' where id = '00000000-0000-0000-0000-0000000000f1';
    raise exception 'owner wrote credential columns directly';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.businesses (owner_id, name, wa_phone_number_id) values ('00000000-0000-0000-0000-0000000000e1', 'dup', '9999');
    raise exception 'owner created a business with a chosen phone number id';
  exception when insufficient_privilege then null; end;

  -- a lead's number and owning business are fixed
  begin
    update public.leads set wa_contact_number = '60999' where id = '00000000-0000-0000-0000-0000000000a9';
    raise exception 'owner changed a lead phone number directly';
  exception when insufficient_privilege then null; end;
  begin
    update public.leads set business_id = '00000000-0000-0000-0000-0000000000f2' where id = '00000000-0000-0000-0000-0000000000a9';
    raise exception 'owner moved a lead to another business';
  exception when insufficient_privilege then null; end;

  -- a follow-up can not be repointed, to another business's lead or anyone else
  begin
    update public.follow_ups set lead_id = '00000000-0000-0000-0000-0000000000b9' where id = '00000000-0000-0000-0000-0000000000c9';
    raise exception 'owner repointed a follow-up';
  exception when insufficient_privilege then null; end;
end $$;
rollback;

-- the server keeps full access
begin;
set local role service_role;
do $$
declare n int;
begin
  update public.businesses set wa_phone_number_id = '9101', wa_connection_type = 'embedded' where id = '00000000-0000-0000-0000-0000000000f1';
  get diagnostics n = row_count; assert n = 1, 'the server can write the connection columns';
  update public.leads set wa_contact_number = '6012' where id = '00000000-0000-0000-0000-0000000000a9';
  get diagnostics n = row_count; assert n = 1, 'the server can write lead numbers';
end $$;
rollback;

\echo column_limits: all assertions passed
