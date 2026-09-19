-- WhatsApp Sales CRM: initial schema
-- Run in the Supabase SQL editor, or save as supabase/migrations/0001_init.sql

create extension if not exists "pgcrypto";

create type lead_stage as enum ('new', 'talking', 'quoted', 'won', 'lost');
create type msg_direction as enum ('in', 'out');
create type draft_status as enum ('pending', 'sent', 'dismissed');

-- One business per owner for v1 (team seats come later)
create table businesses (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  wa_phone_number_id text unique,          -- WhatsApp Cloud API phone number id
  wa_owner_number text,                    -- where the morning digest is sent
  tone_notes text,                         -- owner's style, e.g. "casual, uses kak, emoji ok"
  timezone text not null default 'Asia/Kuala_Lumpur',
  cold_after_days int not null default 3,
  created_at timestamptz not null default now()
);

create table leads (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  wa_contact_number text not null,
  name text,
  need text,
  budget_myr int,
  deadline date,
  stage lead_stage not null default 'new',
  language text,                           -- 'en', 'bm', 'manglish', ...
  last_message_at timestamptz,
  last_inbound_at timestamptz,
  last_outbound_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, wa_contact_number)
);

create index leads_business_stage_idx on leads (business_id, stage);
create index leads_last_message_idx on leads (business_id, last_message_at);

create table messages (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads(id) on delete cascade,
  business_id uuid not null references businesses(id) on delete cascade,
  wa_message_id text not null unique,      -- dedupe webhook retries
  direction msg_direction not null,
  body text,
  sent_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index messages_lead_time_idx on messages (lead_id, sent_at);

create table drafts (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads(id) on delete cascade,
  business_id uuid not null references businesses(id) on delete cascade,
  body text not null,
  status draft_status not null default 'pending',
  created_at timestamptz not null default now()
);

-- Cold leads: open stage and no message for cold_after_days
create view cold_leads as
select
  l.*,
  extract(day from now() - l.last_message_at)::int as days_quiet
from leads l
join businesses b on b.id = l.business_id
where l.stage in ('new', 'talking', 'quoted')
  and l.last_message_at is not null
  and l.last_message_at < now() - make_interval(days => b.cold_after_days);

-- Row level security: owners only see their own business
alter table businesses enable row level security;
alter table leads enable row level security;
alter table messages enable row level security;
alter table drafts enable row level security;

create policy "owner reads own business" on businesses
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy "owner reads own leads" on leads
  for all using (business_id in (select id from businesses where owner_id = auth.uid()))
  with check (business_id in (select id from businesses where owner_id = auth.uid()));

create policy "owner reads own messages" on messages
  for all using (business_id in (select id from businesses where owner_id = auth.uid()))
  with check (business_id in (select id from businesses where owner_id = auth.uid()));

create policy "owner reads own drafts" on drafts
  for all using (business_id in (select id from businesses where owner_id = auth.uid()))
  with check (business_id in (select id from businesses where owner_id = auth.uid()));

-- Webhook and cron jobs use the service role key, which bypasses RLS.
