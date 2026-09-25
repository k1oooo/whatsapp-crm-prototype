-- 0001_init.sql
create extension if not exists "pgcrypto";

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

/* ---------- businesses ---------- */
create table if not exists public.businesses (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  wa_phone_number_id text not null,
  wa_owner_number text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists businesses_owner_id_key on public.businesses (owner_id);
create unique index if not exists businesses_wa_phone_number_id_key on public.businesses (wa_phone_number_id);

drop trigger if exists businesses_set_updated_at on public.businesses;
create trigger businesses_set_updated_at
  before update on public.businesses
  for each row execute function public.set_updated_at();

create or replace function public.owner_business_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.businesses where owner_id = auth.uid();
$$;

alter table public.businesses enable row level security;

drop policy if exists "Owner can read their business" on public.businesses;
create policy "Owner can read their business"
  on public.businesses for select
  to authenticated
  using (owner_id = (select auth.uid()));

drop policy if exists "Owner can update their business" on public.businesses;
create policy "Owner can update their business"
  on public.businesses for update
  to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

/* ---------- leads ---------- */
create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  wa_contact_number text not null,
  name text,
  need text,
  budget_myr integer check (budget_myr is null or budget_myr >= 0),
  deadline date,
  stage text not null default 'new'
    check (stage in ('new', 'talking', 'quoted', 'won', 'lost')),
  language text,
  last_message_at timestamptz,
  last_inbound_at timestamptz,
  last_outbound_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists leads_business_contact_key on public.leads (business_id, wa_contact_number);
create index if not exists leads_business_last_message_idx on public.leads (business_id, last_message_at desc);

drop trigger if exists leads_set_updated_at on public.leads;
create trigger leads_set_updated_at
  before update on public.leads
  for each row execute function public.set_updated_at();

alter table public.leads enable row level security;

drop policy if exists "Owner can read their leads" on public.leads;
create policy "Owner can read their leads"
  on public.leads for select
  to authenticated
  using (business_id in (select public.owner_business_ids()));

drop policy if exists "Owner can update their leads" on public.leads;
create policy "Owner can update their leads"
  on public.leads for update
  to authenticated
  using (business_id in (select public.owner_business_ids()))
  with check (business_id in (select public.owner_business_ids()));

/* ---------- messages ---------- */
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads (id) on delete cascade,
  business_id uuid not null references public.businesses (id) on delete cascade,
  wa_message_id text not null,
  direction text not null check (direction in ('in', 'out')),
  body text,
  source text check (source in ('customer', 'owner', 'bot', 'dashboard')),
  sent_at timestamptz not null,
  created_at timestamptz not null default now()
);

create unique index if not exists messages_wa_message_id_key on public.messages (wa_message_id);
create index if not exists messages_lead_sent_idx on public.messages (lead_id, sent_at, created_at);
create index if not exists messages_business_sent_idx on public.messages (business_id, sent_at desc, created_at desc);

alter table public.messages enable row level security;

drop policy if exists "Owner can read their messages" on public.messages;
create policy "Owner can read their messages"
  on public.messages for select
  to authenticated
  using (business_id in (select public.owner_business_ids()));

drop policy if exists "Owner can insert messages for their leads" on public.messages;
create policy "Owner can insert messages for their leads"
  on public.messages for insert
  to authenticated
  with check (
    business_id in (select public.owner_business_ids())
    and exists (
      select 1 from public.leads l
      where l.id = lead_id and l.business_id = messages.business_id
    )
  );