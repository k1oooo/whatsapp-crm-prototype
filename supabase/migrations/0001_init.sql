-- 0001_init.sql
-- Core schema: businesses, leads, messages, with row level security so each owner only sees
-- their own business's data.
--
-- Safe to run on an empty database AND on one built from an older version of this file.
-- "create table if not exists" never adds columns to a table that already exists, so each table
-- is followed by "add column if not exists" for every non-key column. That is what repairs an
-- older table (for example one missing updated_at, which the updated_at trigger below needs).

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

alter table public.businesses
  add column if not exists wa_owner_number text,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

-- One owner = one business, and one WhatsApp number = one business. If the table already holds
-- duplicates the unique index cannot be built, so stop with instructions instead of a bare
-- "could not create unique index" error. Nothing is deleted automatically: removing a business
-- also removes its leads and messages.
do $$
begin
  if exists (select 1 from public.businesses group by owner_id having count(*) > 1) then
    raise exception
      'Some owners have more than one row in businesses. Find them with: select owner_id, count(*) from public.businesses group by owner_id having count(*) > 1; check the extra rows have no leads or messages, delete them, then run this file again.';
  end if;
  if exists (
    select 1 from public.businesses where wa_phone_number_id is not null
    group by wa_phone_number_id having count(*) > 1
  ) then
    raise exception
      'Two businesses share one wa_phone_number_id. Find them with: select wa_phone_number_id, count(*) from public.businesses group by wa_phone_number_id having count(*) > 1; fix or delete the extra rows, then run this file again.';
  end if;
end $$;

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

alter table public.leads
  add column if not exists name text,
  add column if not exists need text,
  add column if not exists budget_myr integer check (budget_myr is null or budget_myr >= 0),
  add column if not exists deadline date,
  add column if not exists stage text not null default 'new'
    check (stage in ('new', 'talking', 'quoted', 'won', 'lost')),
  add column if not exists language text,
  add column if not exists last_message_at timestamptz,
  add column if not exists last_inbound_at timestamptz,
  add column if not exists last_outbound_at timestamptz,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

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

alter table public.messages
  add column if not exists body text,
  add column if not exists source text check (source in ('customer', 'owner', 'bot', 'dashboard')),
  add column if not exists created_at timestamptz not null default now();

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

-- Make the API pick up any table/column changes straight away.
notify pgrst, 'reload schema';
