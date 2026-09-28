-- 0012_billing.sql
-- Phase 4: gate the AI on an active subscription. Every business (new and existing) starts
-- with a 14-day trial that needs no credit card; Stripe only enters the picture once someone
-- actually subscribes, via app/api/stripe/webhook.

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null unique references public.businesses (id) on delete cascade,
  stripe_customer_id text,
  stripe_subscription_id text,
  plan text not null default 'standard',
  status text not null default 'trialing' check (status in ('trialing', 'active', 'past_due', 'canceled', 'incomplete')),
  trial_ends_at timestamptz,
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists subscriptions_stripe_customer_id_key
  on public.subscriptions (stripe_customer_id) where stripe_customer_id is not null;
create unique index if not exists subscriptions_stripe_subscription_id_key
  on public.subscriptions (stripe_subscription_id) where stripe_subscription_id is not null;

-- Every business that existed before this migration gets a fresh 14-day trial.
insert into public.subscriptions (business_id, status, trial_ends_at)
select id, 'trialing', now() + interval '14 days'
from public.businesses
where id not in (select business_id from public.subscriptions);

alter table public.subscriptions enable row level security;

drop policy if exists "Owner can read their subscription" on public.subscriptions;
create policy "Owner can read their subscription"
  on public.subscriptions for select
  to authenticated
  using (business_id in (select public.owner_business_ids()));

-- No insert/update/delete policy for authenticated users: only the Stripe webhook, using the
-- service role (which bypasses RLS), ever writes here. An owner cannot grant themselves a
-- subscription by editing or inserting the row directly.

-- New businesses get their trial from the database itself, not from app code. The app creates
-- businesses as the signed-in owner, who (deliberately) may not insert into subscriptions, and
-- a trigger also covers a business created any other way. SECURITY DEFINER lets it write past
-- RLS on the owner's behalf, and only ever writes this one fixed trial row.
create or replace function public.start_trial_for_new_business()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.subscriptions (business_id, status, trial_ends_at)
  values (new.id, 'trialing', now() + interval '14 days')
  on conflict (business_id) do nothing;
  return new;
end;
$$;

drop trigger if exists businesses_start_trial on public.businesses;
create trigger businesses_start_trial
  after insert on public.businesses
  for each row execute function public.start_trial_for_new_business();

alter table public.leads drop constraint if exists leads_human_reason_check;
alter table public.leads add constraint leads_human_reason_check
  check (human_reason is null or human_reason in ('discount', 'stock', 'payment', 'unsure', 'feedback', 'billing'));
