-- The job queue's claim rules, and dashboard_stats() on a small fixture whose numbers are worked out by hand.
\set ON_ERROR_STOP on

truncate public.inbound_jobs, public.messages, public.feedback, public.follow_ups, public.draft_replies, public.leads cascade;

insert into public.leads (id, business_id, wa_contact_number, name, stage, order_status, quoted_price_myr, order_total_myr, pending_decision, human_reason, paid_at, created_at, last_inbound_at) values
  -- paid this week, exact computed total 46.50 (quoted price is the rounded 47)
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000b1', '801', 'Aina',  'won',  'paid',      47, 46.50, false, null,      now() - interval '1 day',  now() - interval '2 days',  now()),
  -- paid this week, no computed total: falls back to the quoted price
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000b1', '802', null,    'won',  'paid',      36, null,  false, null,      now() - interval '2 days', now() - interval '3 days',  now()),
  -- paid last week
  ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-0000000000b1', '803', 'Chong', 'won',  'paid',      10, null,  false, null,      now() - interval '9 days', now() - interval '10 days', now()),
  -- waiting for payment, needs the owner
  ('00000000-0000-0000-0000-0000000000e4', '00000000-0000-0000-0000-0000000000b1', '804', 'Devi',  'quoted','confirmed', 80, null,  true,  'discount', null,                      now() - interval '1 day',   now() - interval '3 hours');

-- Aina asked at -60 min and was answered at -58 min (120 s). Chong asked at -30 min, answered at -29 (60 s).
insert into public.messages (business_id, lead_id, wa_message_id, direction, body, sent_at, created_at, source) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000e1', 'm1', 'in',  'hi',    now(), now() - interval '60 minutes', 'customer'),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000e1', 'm2', 'out',  'hello', now(), now() - interval '58 minutes', 'bot'),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000e3', 'm3', 'in',  'hi',    now(), now() - interval '30 minutes', 'customer'),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000e3', 'm4', 'out',  'hello', now(), now() - interval '29 minutes', 'owner'),
  -- last week's traffic: 1 customer message, 1 bot reply
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000e4', 'm5', 'in',  'old',   now(), now() - interval '9 days', 'customer'),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000e4', 'm6', 'out',  'old',   now(), now() - interval '9 days' + interval '1 minute', 'bot'),
  -- older than 14 days: must be ignored
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000e4', 'm7', 'in',  'ancient', now(), now() - interval '30 days', 'customer');

insert into public.feedback (business_id, lead_id, rating) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000e1', 5),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000e3', 3),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000e4', null);

do $$
declare s jsonb;
begin
  s := public.dashboard_stats(date_trunc('day', now()), date_trunc('day', now()) + interval '1 day');

  assert (s->>'needs_you')::int = 1, 'one chat needs the owner';
  assert (s->>'waiting_for_payment')::int = 1, 'one order waits for payment';
  assert (s->>'paid_orders')::int = 3, 'three paid orders in all';
  assert (s->'pipeline'->>'won')::int = 3 and (s->'pipeline'->>'quoted')::int = 1, 'pipeline counts by stage';

  assert (s->>'revenue_this')::numeric = 82.50, 'revenue this week: 46.50 computed + 36 quoted fallback';
  assert (s->>'revenue_last')::numeric = 10, 'revenue last week';
  assert (s->>'paid_count_this')::int = 2, 'two paid orders this week';
  assert (s->'top_orders'->0->>'amount')::numeric = 46.50 and (s->'top_orders'->0->>'name') = 'Aina', 'top order first';
  assert jsonb_array_length(s->'top_orders') = 2, 'two orders paid this week';

  -- Aina, the unnamed chat and Devi were created this week (2 of the 3 are paid). Chong's chat is from 10 days ago.
  assert (s->>'created_this')::int = 3 and (s->>'created_this_paid')::int = 2, 'conversion this week: 2 of 3 new chats paid';
  assert (s->>'created_last')::int = 1 and (s->>'created_last_paid')::int = 1, 'last week: 1 new chat, and it paid';

  -- Aina 120 s, Chong 60 s, and Devi's 9 day old exchange 60 s: (120 + 60 + 60) / 3. The 30 day old message is outside the window.
  assert round((s->>'avg_first_reply_seconds')::numeric) = 80, 'average first reply time is 80 seconds';
  assert (s->>'customer_msgs_this')::int = 2 and (s->>'customer_msgs_last')::int = 1, 'customer messages: this week 2, last week 1 (30 days ago ignored)';
  assert (s->>'outbound_this')::int = 2 and (s->>'bot_this')::int = 1, 'outbound this week: 2, one from the assistant';
  assert (s->>'outbound_last')::int = 1 and (s->>'bot_last')::int = 1, 'outbound last week: 1, from the assistant';

  assert (s->>'feedback_count')::int = 3 and round((s->>'feedback_avg')::numeric, 2) = 4.00, 'feedback: 3 rows, average of the 2 ratings given';
  assert jsonb_array_length(s->'activity') = 6, 'activity covers the messages of the last 14 days (6), newest first';
  assert (s->'activity'->0->>'name') = 'Chong', 'newest activity is Chong''s reply';
  assert (s->'attention'->0->>'name') = 'Devi' and (s->'attention'->0->>'reason') = 'discount', 'the chat needing the owner is listed with its reason';
end $$;

-- the claim function ----------------------------------------------------------------------------------
truncate public.inbound_jobs;
insert into public.inbound_jobs (business_id, lead_id) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000e1'),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000e2');

do $$
declare n int;
begin
  select count(*) into n from public.claim_inbound_jobs(10);
  assert n = 2, 'both chats are claimed';

  -- a second message for chat e1 queues behind the running job and is not given out yet
  insert into public.inbound_jobs (business_id, lead_id) values ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000e1');
  select count(*) into n from public.claim_inbound_jobs(10);
  assert n = 0, 'no second job for a chat that already has one running';

  -- the worker for e1 dies: its job is superseded by the waiting one, which is then claimed
  update public.inbound_jobs set locked_until = now() - interval '1 minute' where status = 'running' and lead_id = '00000000-0000-0000-0000-0000000000e1';
  select count(*) into n from public.claim_inbound_jobs(10);
  assert n = 1, 'the waiting job runs once the dead one is cleared';
  assert (select count(*) from public.inbound_jobs where lead_id = '00000000-0000-0000-0000-0000000000e1' and status = 'superseded') = 1, 'the dead job is superseded';

  -- e2's worker dies on its last attempt: the job fails and the chat is flagged for the owner
  update public.inbound_jobs set locked_until = now() - interval '1 minute', attempts = 5 where status = 'running' and lead_id = '00000000-0000-0000-0000-0000000000e2';
  perform public.claim_inbound_jobs(10);
  assert (select status from public.inbound_jobs where lead_id = '00000000-0000-0000-0000-0000000000e2') = 'failed', 'job failed after the last attempt';
  assert (select pending_decision from public.leads where id = '00000000-0000-0000-0000-0000000000e2') = true, 'the chat is flagged for the owner';
end $$;
\echo queue_and_stats: all assertions passed
