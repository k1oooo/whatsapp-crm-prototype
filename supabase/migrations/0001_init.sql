-- 0001_init.sql
-- Core schema: businesses, leads, messages. Row level security so each owner only
-- ever sees their own business's data through the browser/server (anon) client.
-- The webhook and cron job use the service role key and bypass RLS entirely.

create extension if not exists "pgcrypto";

-- Generic "touch updated_at on every update" trigger, reused by every table that has one.
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

create table public.businesses (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  wa_phone_number_id text not null,
  wa_owner_number text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One owner account maps to one business for now (see README/CLAUDE notes if that changes).
create unique index businesses_owner_id_key on public.businesses (owner_id);
-- The webhook looks up the business by the WhatsApp phone_number_id on every message.
create unique index businesses_wa_phone_number_id_key on public.businesses (wa_phone_number_id);

create trigger businesses_set_updated_at
  before update on public.businesses
  for each row execute function public.set_updated_at();

/*
 * Looks up the ids of the businesses the current signed-in user owns.
 * security definer so it reads the businesses table directly instead of recursing
 * through that table's own RLS policies (which would otherwise call this function).
 */
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

create policy "Owner can read their business"
  on public.businesses for select
  to authenticated
  using (owner_id = (select auth.uid()));

create policy "Owner can update their business"
  on public.businesses for update
  to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

/* ---------- leads ---------- */

create table public.leads (
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

-- One row per customer per business; recordMessage() in lib/whatsapp.ts relies on this
-- to detect "another webhook already created this lead" via a 23505 error.
create unique index leads_business_contact_key on public.leads (business_id, wa_contact_number);
-- The inbox list and pipeline board both sort/filter by business_id + last_message_at.
create index leads_business_last_message_idx on public.leads (business_id, last_message_at desc);

create trigger leads_set_updated_at
  before update on public.leads
  for each row execute function public.set_updated_at();

alter table public.leads enable row level security;

create policy "Owner can read their leads"
  on public.leads for select
  to authenticated
  using (business_id in (select public.owner_business_ids()));

-- Needed for moveStage/updateLead/clearPending/confirmPayment etc., which run under the
-- signed-in owner's session, not the service role.
create policy "Owner can update their leads"
  on public.leads for update
  to authenticated
  using (business_id in (select public.owner_business_ids()))
  with check (business_id in (select public.owner_business_ids()));

/* ---------- messages ---------- */

create table public.messages (
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

-- Meta retries webhooks; this is what makes recordMessage()'s duplicate handling work.
create unique index messages_wa_message_id_key on public.messages (wa_message_id);
create index messages_lead_sent_idx on public.messages (lead_id, sent_at, created_at);
-- Used by the dashboard layout to find each chat's most recent message in one query.
create index messages_business_sent_idx on public.messages (business_id, sent_at desc, created_at desc);

alter table public.messages enable row level security;

create policy "Owner can read their messages"
  on public.messages for select
  to authenticated
  using (business_id in (select public.owner_business_ids()));

-- deliver() in app/dashboard/actions.ts inserts the owner's/bot's own reply through the
-- authenticated client (not the service role), so this policy has to allow it. The extra
-- exists() check stops a message being filed under an owned business_id but someone
-- else's lead_id.
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
