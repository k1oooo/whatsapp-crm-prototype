-- 0007_follow_ups.sql
-- After-sale follow-ups (feedback requests, reorder reminders, marketing broadcasts),
-- the customer's consent to receive them, and the feedback they send back.

alter table public.leads
  add column follow_up_consent text not null default 'unknown'
    check (follow_up_consent in ('unknown', 'yes', 'no')),
  add column consent_asked_at timestamptz,
  add column awaiting_feedback boolean not null default false,
  add column paid_at timestamptz;

alter table public.businesses
  add column follow_up_settings jsonb not null default '{}'::jsonb;

/* ---------- follow_ups ---------- */

create table public.follow_ups (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  lead_id uuid not null references public.leads (id) on delete cascade,
  kind text not null check (kind in ('feedback', 'reorder', 'marketing')),
  status text not null default 'scheduled'
    check (status in ('scheduled', 'sending', 'sent', 'skipped', 'failed')),
  due_at timestamptz not null,
  sent_at timestamptz,
  detail text,
  campaign text,
  template_name text,
  body text,
  -- The paid_at instant of the order this follow-up belongs to. Null for a marketing
  -- broadcast, which isn't tied to one order. See scheduleAfterPayment() in lib/follow-ups.ts.
  order_key timestamptz,
  created_at timestamptz not null default now()
);

-- scheduleAfterPayment() relies on a unique-violation (23505) to treat "already queued
-- for this order" as a no-op instead of an error. NULLs (marketing rows) don't collide.
create unique index follow_ups_lead_kind_order_key on public.follow_ups (lead_id, kind, order_key);
-- The daily cron job's core query: everything scheduled and due.
create index follow_ups_due_idx on public.follow_ups (status, due_at);
create index follow_ups_business_due_idx on public.follow_ups (business_id, due_at desc);

alter table public.follow_ups enable row level security;

create policy "Owner can read their follow-ups"
  on public.follow_ups for select
  to authenticated
  using (business_id in (select public.owner_business_ids()));

-- sendBroadcast() queues marketing rows through the authenticated client. The extra
-- exists() check stops a row being filed under an owned business_id but someone else's
-- lead_id.
create policy "Owner can queue follow-ups for their business"
  on public.follow_ups for insert
  to authenticated
  with check (
    business_id in (select public.owner_business_ids())
    and exists (
      select 1 from public.leads l
      where l.id = lead_id and l.business_id = follow_ups.business_id
    )
  );

-- skipFollowUp()/sendFollowUpNow(), and runDueFollowUps() when triggered by "Run now"
-- or "Send now" (as opposed to the cron job, which uses the service role).
create policy "Owner can update their follow-ups"
  on public.follow_ups for update
  to authenticated
  using (business_id in (select public.owner_business_ids()))
  with check (business_id in (select public.owner_business_ids()));

/* ---------- feedback ---------- */

create table public.feedback (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  lead_id uuid not null references public.leads (id) on delete cascade,
  rating integer check (rating is null or (rating between 1 and 5)),
  comment text,
  created_at timestamptz not null default now()
);

create index feedback_business_created_idx on public.feedback (business_id, created_at desc);

alter table public.feedback enable row level security;

-- Feedback is only ever written by the webhook handler under the service role, so the
-- owner only needs read access here.
create policy "Owner can read their feedback"
  on public.feedback for select
  to authenticated
  using (business_id in (select public.owner_business_ids()));
