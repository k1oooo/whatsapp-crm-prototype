-- 0007_follow_ups.sql

DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='leads' AND column_name='follow_up_consent') THEN
    ALTER TABLE public.leads ADD COLUMN follow_up_consent text not null default 'unknown' check (follow_up_consent in ('unknown', 'yes', 'no'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='leads' AND column_name='consent_asked_at') THEN
    ALTER TABLE public.leads ADD COLUMN consent_asked_at timestamptz;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='leads' AND column_name='awaiting_feedback') THEN
    ALTER TABLE public.leads ADD COLUMN awaiting_feedback boolean not null default false;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='leads' AND column_name='paid_at') THEN
    ALTER TABLE public.leads ADD COLUMN paid_at timestamptz;
  END IF;
END $$;

DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='businesses' AND column_name='follow_up_settings') THEN
    ALTER TABLE public.businesses ADD COLUMN follow_up_settings jsonb not null default '{}'::jsonb;
  END IF;
END $$;

/* ---------- follow_ups ---------- */

create table if not exists public.follow_ups (
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
  order_key timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists follow_ups_lead_kind_order_key on public.follow_ups (lead_id, kind, order_key);
create index if not exists follow_ups_due_idx on public.follow_ups (status, due_at);
create index if not exists follow_ups_business_due_idx on public.follow_ups (business_id, due_at desc);

alter table public.follow_ups enable row level security;

drop policy if exists "Owner can read their follow-ups" on public.follow_ups;
create policy "Owner can read their follow-ups"
  on public.follow_ups for select
  to authenticated
  using (business_id in (select public.owner_business_ids()));

drop policy if exists "Owner can queue follow-ups for their business" on public.follow_ups;
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

drop policy if exists "Owner can update their follow-ups" on public.follow_ups;
create policy "Owner can update their follow-ups"
  on public.follow_ups for update
  to authenticated
  using (business_id in (select public.owner_business_ids()))
  with check (business_id in (select public.owner_business_ids()));

/* ---------- feedback ---------- */

create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  lead_id uuid not null references public.leads (id) on delete cascade,
  rating integer check (rating is null or (rating between 1 and 5)),
  comment text,
  created_at timestamptz not null default now()
);

create index if not exists feedback_business_created_idx on public.feedback (business_id, created_at desc);

alter table public.feedback enable row level security;

drop policy if exists "Owner can read their feedback" on public.feedback;
create policy "Owner can read their feedback"
  on public.feedback for select
  to authenticated
  using (business_id in (select public.owner_business_ids()));