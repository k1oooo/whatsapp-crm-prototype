-- 0016: scale and observability.
--   1. follow_ups.claimed_at, so a follow-up stuck in "sending" can be found and reported.
--   2. Message search that uses an index (pg_trgm) and returns one row per chat.
--   3. dashboard_stats(): the overview numbers computed in SQL, without the 1000-message cap.
-- Safe to run more than once.

-- 1. When a worker started sending a follow-up.
alter table public.follow_ups add column if not exists claimed_at timestamptz;

-- 2. Search. ilike '%word%' on a big table is a full scan; a trigram index makes it an index lookup.
-- The extension may already live in a schema other than public (Supabase uses "extensions"), so find
-- where it is and qualify the operator class from there.
do $$
declare ns text;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_trgm') then
    create extension pg_trgm;
  end if;
  select n.nspname into ns
    from pg_extension e join pg_namespace n on n.oid = e.extnamespace
   where e.extname = 'pg_trgm';
  execute format(
    'create index if not exists messages_body_trgm_idx on public.messages using gin (body %I.gin_trgm_ops)', ns);
end $$;

-- The overview reads recent messages of one business by time.
create index if not exists messages_business_created_idx on public.messages (business_id, created_at desc);

-- One row per chat that mentions the text, most recently active first. security invoker: row level
-- security still limits this to the signed-in owner's own business.
create or replace function public.search_leads_by_message(p_query text, p_limit int default 50)
returns table (lead_id uuid)
language sql
stable
security invoker
set search_path = public
as $$
  select m.lead_id
    from public.messages m
   where length(trim(p_query)) >= 2
     and m.body ilike '%' || replace(replace(replace(trim(p_query), '\', '\\'), '%', '\%'), '_', '\_') || '%'
   group by m.lead_id
   order by max(m.created_at) desc
   limit least(greatest(p_limit, 1), 100);
$$;
revoke all on function public.search_leads_by_message(text, int) from public, anon;
grant execute on function public.search_leads_by_message(text, int) to authenticated, service_role;

-- 3. Everything the dashboard overview needs, as raw numbers. The app turns them into labels and
-- percentages. "This week" is the 7 days before p_now, "last week" the 7 days before that. Like the
-- search function this is security invoker, so it only ever sees the signed-in owner's rows.
create or replace function public.dashboard_stats(
  p_today_start timestamptz,
  p_tomorrow_start timestamptz,
  p_now timestamptz default now()
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with
  win as (select p_now - interval '7 days' as wk, p_now - interval '14 days' as wk2),
  l as (
    select id, name, wa_contact_number, stage, order_status, pending_decision, human_reason,
           last_inbound_at, paid_at, created_at,
           coalesce(order_total_myr, quoted_price_myr, 0)::numeric as value
      from public.leads
  ),
  paid_this as (select * from l, win where order_status = 'paid' and paid_at is not null and paid_at >= win.wk),
  paid_last as (select * from l, win where order_status = 'paid' and paid_at is not null and paid_at >= win.wk2 and paid_at < win.wk),
  made_this as (select * from l, win where created_at >= win.wk),
  made_last as (select * from l, win where created_at >= win.wk2 and created_at < win.wk),
  m as (select id, lead_id, source, body, created_at from public.messages, win where created_at >= win.wk2),
  first_customer as (select lead_id, min(created_at) as t from m where source = 'customer' group by lead_id),
  first_reply as (
    select fc.t as t1,
           (select min(x.created_at) from m x
             where x.lead_id = fc.lead_id and x.created_at > fc.t and x.source in ('owner', 'bot')) as t2
      from first_customer fc
  )
  select jsonb_build_object(
    'needs_you', (select count(*) from l where pending_decision),
    'waiting_for_payment', (select count(*) from l where order_status = 'confirmed'),
    'paid_orders', (select count(*) from l where order_status = 'paid'),
    'pipeline', coalesce((select jsonb_object_agg(stage, n) from (select stage, count(*) as n from l group by stage) s), '{}'::jsonb),
    'attention', coalesce((
      select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'number', wa_contact_number,
                                          'reason', human_reason, 'since', coalesce(last_inbound_at, created_at))
                       order by coalesce(last_inbound_at, created_at))
        from (select * from l where pending_decision order by coalesce(last_inbound_at, created_at) limit 5) a
    ), '[]'::jsonb),
    'revenue_this', (select coalesce(sum(value), 0) from paid_this),
    'revenue_last', (select coalesce(sum(value), 0) from paid_last),
    'paid_count_this', (select count(*) from paid_this),
    'created_this', (select count(*) from made_this),
    'created_this_paid', (select count(*) from made_this where order_status = 'paid'),
    'created_last', (select count(*) from made_last),
    'created_last_paid', (select count(*) from made_last where order_status = 'paid'),
    'top_orders', coalesce((
      select jsonb_agg(jsonb_build_object('name', name, 'number', wa_contact_number, 'amount', value) order by value desc, paid_at desc)
        from (select * from paid_this order by value desc, paid_at desc limit 3) t
    ), '[]'::jsonb),
    'avg_first_reply_seconds', (select avg(extract(epoch from (t2 - t1))) from first_reply where t2 is not null),
    'customer_msgs_this', (select count(*) from m, win where source = 'customer' and created_at >= win.wk),
    'customer_msgs_last', (select count(*) from m, win where source = 'customer' and created_at < win.wk),
    'outbound_this', (select count(*) from m, win where source in ('owner', 'bot') and created_at >= win.wk),
    'bot_this', (select count(*) from m, win where source = 'bot' and created_at >= win.wk),
    'outbound_last', (select count(*) from m, win where source in ('owner', 'bot') and created_at < win.wk),
    'bot_last', (select count(*) from m, win where source = 'bot' and created_at < win.wk),
    'due_today_feedback', (select count(*) from public.follow_ups where status = 'scheduled' and kind = 'feedback' and due_at >= p_today_start and due_at < p_tomorrow_start),
    'due_today_reorder', (select count(*) from public.follow_ups where status = 'scheduled' and kind = 'reorder' and due_at >= p_today_start and due_at < p_tomorrow_start),
    'feedback_avg', (select avg(rating) from public.feedback where rating is not null),
    'feedback_count', (select count(*) from public.feedback),
    'activity', coalesce((
      select jsonb_agg(jsonb_build_object('id', id, 'lead_id', lead_id, 'source', source,
                                          'snippet', left(body, 61), 'at', created_at,
                                          'name', lname, 'number', lnum) order by created_at desc)
        from (select m2.id, m2.lead_id, m2.source, m2.body, m2.created_at, l2.name as lname, l2.wa_contact_number as lnum
                from m m2 left join l l2 on l2.id = m2.lead_id
               order by m2.created_at desc limit 8) r
    ), '[]'::jsonb)
  );
$$;
revoke all on function public.dashboard_stats(timestamptz, timestamptz, timestamptz) from public, anon;
grant execute on function public.dashboard_stats(timestamptz, timestamptz, timestamptz) to authenticated, service_role;
