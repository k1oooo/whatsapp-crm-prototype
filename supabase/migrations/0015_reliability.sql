-- 0015: reliability and correct money.
--   1. WhatsApp message ids are unique per business, not globally.
--   2. Menu items can carry a fixed price, and orders keep their lines and a computed total.
--   3. A durable queue for inbound messages (inbound_jobs), one running job per chat at a time.
-- Safe to run more than once.

-- 1. A message id from one business must never make another business's message look like a duplicate.
-- The old global uniqueness exists in one of two forms depending on how the project was first set up:
-- a UNIQUE constraint on the column (which owns its index, and the index can not be dropped on its
-- own), or a plain unique index. Drop whichever is there, then add the per-business index.
do $$
declare
  r record;
  col int2;
begin
  select attnum into col
    from pg_attribute
   where attrelid = 'public.messages'::regclass and attname = 'wa_message_id' and not attisdropped;

  -- UNIQUE constraints on exactly (wa_message_id), whatever they are called.
  for r in
    select conname
      from pg_constraint
     where conrelid = 'public.messages'::regclass
       and contype = 'u'
       and conkey = array[col]
  loop
    execute format('alter table public.messages drop constraint %I', r.conname);
  end loop;

  -- Plain unique indexes on exactly (wa_message_id) that are left (the primary key is on id, so it is safe).
  for r in
    select c.relname
      from pg_index i
      join pg_class c on c.oid = i.indexrelid
     where i.indrelid = 'public.messages'::regclass
       and i.indisunique
       and i.indnatts = 1
       and i.indkey[0] = col
       and i.indpred is null
  loop
    execute format('drop index public.%I', r.relname);
  end loop;
end $$;

create unique index if not exists messages_business_wa_message_id_key
  on public.messages (business_id, wa_message_id);

-- 2. Prices and totals. The total is computed by the server from these prices, never by the AI.
alter table public.knowledge_entries
  add column if not exists price_myr numeric(10, 2) check (price_myr is null or price_myr >= 0);

alter table public.leads
  add column if not exists order_lines jsonb,
  add column if not exists order_total_myr numeric(10, 2) check (order_total_myr is null or order_total_myr >= 0);

alter table public.draft_replies
  add column if not exists order_lines jsonb,
  add column if not exists order_total_myr numeric(10, 2) check (order_total_myr is null or order_total_myr >= 0);

-- 3. Inbound message queue. The webhook stores the message and queues a job, then answers Meta.
-- A worker claims jobs, so a crash or a timeout leaves the job to be retried instead of lost.
create table if not exists public.inbound_jobs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  lead_id uuid not null references public.leads (id) on delete cascade,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'done', 'failed', 'superseded')),
  attempts int not null default 0,
  run_after timestamptz not null default now(),
  locked_until timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- At most one waiting job per chat (a second message just joins it: the job reads the whole chat),
-- and at most one running job per chat, so two workers can never answer the same chat at once.
create unique index if not exists inbound_jobs_one_queued_per_lead
  on public.inbound_jobs (lead_id) where status = 'queued';
create unique index if not exists inbound_jobs_one_running_per_lead
  on public.inbound_jobs (lead_id) where status = 'running';
create index if not exists inbound_jobs_due_idx
  on public.inbound_jobs (run_after) where status = 'queued';
create index if not exists inbound_jobs_finished_idx
  on public.inbound_jobs (updated_at) where status in ('done', 'failed', 'superseded');

-- No policies on purpose: only the server (service role) reads or writes the queue.
alter table public.inbound_jobs enable row level security;

-- Claim up to p_limit due jobs. First it recovers jobs whose worker died (lease ran out): they go
-- back to the queue, or fail for good after p_max_attempts, in which case the chat is flagged for
-- the owner. Then it claims, skipping chats that already have a job running.
create or replace function public.claim_inbound_jobs(
  p_limit int default 5,
  p_lease_seconds int default 300,
  p_max_attempts int default 5
)
returns setof public.inbound_jobs
language plpgsql
security definer
set search_path = public
as $$
begin
  with stale as (
    update public.inbound_jobs s
       set status = case
             when exists (select 1 from public.inbound_jobs q where q.lead_id = s.lead_id and q.status = 'queued')
               then 'superseded'
             when s.attempts >= p_max_attempts then 'failed'
             else 'queued'
           end,
           last_error = coalesce(s.last_error, 'The worker stopped before finishing.'),
           locked_until = null,
           updated_at = now()
     where s.status = 'running' and s.locked_until < now()
    returning s.lead_id, s.status
  )
  update public.leads l
     set pending_decision = true,
         human_reason = 'unsure',
         handoff_note = 'The assistant could not process this customer''s message after several tries. Please reply.',
         updated_at = now()
    from stale
   where l.id = stale.lead_id and stale.status = 'failed';

  return query
  with candidates as (
    select j.id
      from public.inbound_jobs j
     where j.status = 'queued'
       and j.run_after <= now()
       and not exists (
         select 1 from public.inbound_jobs r where r.lead_id = j.lead_id and r.status = 'running'
       )
     order by j.run_after, j.created_at
     limit p_limit
     for update skip locked
  )
  update public.inbound_jobs j
     set status = 'running',
         attempts = j.attempts + 1,
         locked_until = now() + make_interval(secs => p_lease_seconds),
         updated_at = now()
    from candidates c
   where j.id = c.id
  returning j.*;
end;
$$;

revoke all on function public.claim_inbound_jobs(int, int, int) from public, anon, authenticated;
grant execute on function public.claim_inbound_jobs(int, int, int) to service_role;
