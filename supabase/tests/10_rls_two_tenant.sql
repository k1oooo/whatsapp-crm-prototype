-- Two businesses, one database. Each test signs in as one owner and proves they can not see or touch
-- the other's rows, and that the server-only parts (job queue, claim function) are closed to owners.
-- Run by scripts/test-db.sh. Any failed assert stops the run with its message.
\set ON_ERROR_STOP on

-- fixtures (as the table owner, which bypasses RLS) ------------------------------------------------
insert into auth.users (id) values ('00000000-0000-0000-0000-0000000000a1'), ('00000000-0000-0000-0000-0000000000a2');
insert into public.businesses (id, owner_id, name, wa_phone_number_id) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1', 'A', '111'),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000a2', 'B', '222');
insert into public.leads (id, business_id, wa_contact_number, name, pending_decision) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000b1', '601', 'A one', false),
  ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000b1', '602', 'A two', false),
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000b2', '701', 'B one', true);
insert into public.messages (business_id, lead_id, wa_message_id, direction, body, sent_at, source) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000c1', 'wamid.same', 'in', 'cupcake order for A', now(), 'customer'),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000c2', 'wamid.a2', 'in', 'we got 100% sure', now(), 'customer'),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000d1', 'wamid.same', 'in', 'cupcake order for B', now(), 'customer');
insert into public.draft_replies (lead_id, business_id, body) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000b1', 'draft A'),
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000b2', 'draft B');
insert into public.follow_ups (business_id, lead_id, kind, due_at) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000c1', 'feedback', now()),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000d1', 'feedback', now());
insert into public.knowledge_entries (business_id, category, title, content) values
  ('00000000-0000-0000-0000-0000000000b1', 'menu', 'A cake', 'x'),
  ('00000000-0000-0000-0000-0000000000b2', 'menu', 'B cake', 'x');
insert into public.feedback (business_id, lead_id, rating) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000c1', 5),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000d1', 1);
insert into public.inbound_jobs (business_id, lead_id) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000c1'),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000d1');

-- owner A -----------------------------------------------------------------------------------------
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true) as _ \gset

do $$
declare n int;
begin
  assert (select count(*) from public.businesses) = 1, 'A sees only their own business';
  assert (select count(*) from public.leads) = 2, 'A sees only their own leads';
  assert (select count(*) from public.messages) = 2, 'A sees only their own messages';
  assert (select count(*) from public.draft_replies) = 1, 'A sees only their own drafts';
  assert (select count(*) from public.follow_ups) = 1, 'A sees only their own follow-ups';
  assert (select count(*) from public.knowledge_entries) = 1, 'A sees only their own knowledge';
  assert (select count(*) from public.feedback) = 1, 'A sees only their own feedback';
  assert (select count(*) from public.inbound_jobs) = 0, 'the job queue is closed to owners';

  -- reading someone else's row by its exact id still returns nothing
  assert (select count(*) from public.leads where id = '00000000-0000-0000-0000-0000000000d1') = 0, 'B lead is invisible by id';

  -- writes to B's rows touch nothing
  update public.leads set name = 'hacked' where id = '00000000-0000-0000-0000-0000000000d1';
  get diagnostics n = row_count; assert n = 0, 'A can not update B lead';
  delete from public.draft_replies where lead_id = '00000000-0000-0000-0000-0000000000d1';
  get diagnostics n = row_count; assert n = 0, 'A can not delete B draft';
  update public.businesses set name = 'hacked' where id = '00000000-0000-0000-0000-0000000000b2';
  get diagnostics n = row_count; assert n = 0, 'A can not update B business';
  update public.follow_ups set detail = 'hacked' where business_id = '00000000-0000-0000-0000-0000000000b2';
  get diagnostics n = row_count; assert n = 0, 'A can not update B follow-ups';

  -- but their own rows work
  update public.leads set name = 'A one edited' where id = '00000000-0000-0000-0000-0000000000c1';
  get diagnostics n = row_count; assert n = 1, 'A can update their own lead';
end $$;

-- inserts into B's business are refused outright
do $$ begin
  begin
    insert into public.messages (business_id, lead_id, wa_message_id, direction, body, sent_at, source)
    values ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000d1', 'wamid.evil', 'in', 'x', now(), 'customer');
    raise exception 'A inserted a message into B';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.follow_ups (business_id, lead_id, kind, due_at)
    values ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000d1', 'reorder', now());
    raise exception 'A queued a follow-up for B';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.knowledge_entries (business_id, category, title, content)
    values ('00000000-0000-0000-0000-0000000000b2', 'menu', 'planted', 'x');
    raise exception 'A planted knowledge in B';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.businesses (owner_id, name, wa_phone_number_id)
    values ('00000000-0000-0000-0000-0000000000a2', 'impostor', '999');
    raise exception 'A created a business owned by B';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.leads (business_id, wa_contact_number) values ('00000000-0000-0000-0000-0000000000b1', '699');
    raise exception 'an owner created a lead (only the server may)';
  exception when insufficient_privilege then null; end;
  begin
    perform public.claim_inbound_jobs(5);
    raise exception 'an owner called claim_inbound_jobs';
  exception when insufficient_privilege then null; end;
end $$;

-- search and stats are scoped by the same rules
do $$
declare ids uuid[];
begin
  select array_agg(lead_id) into ids from public.search_leads_by_message('cupcake');
  assert ids = array['00000000-0000-0000-0000-0000000000c1']::uuid[], 'search finds only A''s chat for "cupcake", not B''s';

  select array_agg(lead_id) into ids from public.search_leads_by_message('0% s');
  assert ids = array['00000000-0000-0000-0000-0000000000c2']::uuid[], 'a literal percent sign in a search is matched as text';
  assert (select count(*) from public.search_leads_by_message('%%')) = 0, '"%%" is not a wildcard that matches everything';
  assert (select count(*) from public.search_leads_by_message('_')) = 0, 'a one character search returns nothing';

  assert (public.dashboard_stats(date_trunc('day', now()), date_trunc('day', now()) + interval '1 day')->>'needs_you')::int = 0,
    'A''s dashboard does not count B''s chat that needs attention';
  assert (public.dashboard_stats(date_trunc('day', now()), date_trunc('day', now()) + interval '1 day')->>'feedback_count')::int = 1,
    'A''s dashboard counts only A''s feedback';
end $$;
rollback;

-- owner B -----------------------------------------------------------------------------------------
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', true) as _ \gset
do $$ begin
  assert (select count(*) from public.leads) = 1, 'B sees only their own lead';
  assert (select count(*) from public.messages) = 1, 'B sees only their own message';
  assert (select name from public.businesses) = 'B', 'B sees their own business, unchanged by A''s attempts';
  assert (public.dashboard_stats(date_trunc('day', now()), date_trunc('day', now()) + interval '1 day')->>'needs_you')::int = 1,
    'B''s dashboard counts their own chat that needs attention';
end $$;
rollback;

-- signed out ----------------------------------------------------------------------------------------
begin;
set local role anon;
do $$ begin
  assert (select count(*) from public.leads) = 0, 'a signed out visitor sees no leads';
  assert (select count(*) from public.messages) = 0, 'a signed out visitor sees no messages';
  assert (select count(*) from public.businesses) = 0, 'a signed out visitor sees no businesses';
  begin
    perform public.claim_inbound_jobs(5);
    raise exception 'anon called claim_inbound_jobs';
  exception when insufficient_privilege then null; end;
  begin
    perform public.dashboard_stats(now(), now());
    raise exception 'anon called dashboard_stats';
  exception when insufficient_privilege then null; end;
end $$;
rollback;

-- the server (service role) -------------------------------------------------------------------------
begin;
set local role service_role;
do $$
declare claimed int;
begin
  assert (select count(*) from public.leads) = 3, 'the server sees every lead';
  select count(*) into claimed from public.claim_inbound_jobs(10);
  assert claimed = 2, 'the server can claim jobs (one per chat)';
end $$;
rollback;

-- constraints the app relies on (as table owner) ----------------------------------------------------
do $$ begin
  -- the same WhatsApp message id in a different business is allowed (fixtures above did exactly that) ...
  assert (select count(*) from public.messages where wa_message_id = 'wamid.same') = 2, 'one wamid in two businesses';
  -- ... but a repeat inside one business is rejected
  begin
    insert into public.messages (business_id, lead_id, wa_message_id, direction, body, sent_at, source)
    values ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000c1', 'wamid.same', 'in', 'dup', now(), 'customer');
    raise exception 'a duplicate message id was accepted within one business';
  exception when unique_violation then null; end;
  -- one waiting job per chat
  begin
    insert into public.inbound_jobs (business_id, lead_id) values ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000c1');
    raise exception 'two queued jobs for one chat were accepted';
  exception when unique_violation then null; end;
end $$;
\echo rls_two_tenant: all assertions passed
