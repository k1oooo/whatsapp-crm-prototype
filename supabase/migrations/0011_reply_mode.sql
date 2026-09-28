-- 0011_reply_mode.sql
-- Phase 3: let an owner choose "AI replies automatically" vs "AI drafts, I approve every send".
-- reply_mode only matters while auto_reply is on; it does nothing on its own.

alter table public.businesses
  add column if not exists reply_mode text not null default 'auto'
  check (reply_mode in ('auto', 'approve'));

-- One pending draft per lead: the reply the assistant would have sent, held for approval instead.
create table if not exists public.draft_replies (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null unique references public.leads (id) on delete cascade,
  business_id uuid not null references public.businesses (id) on delete cascade,
  body text not null,
  order_status text check (order_status in ('none', 'collecting', 'awaiting_confirmation', 'confirmed', 'paid')),
  order_summary text,
  created_at timestamptz not null default now()
);

alter table public.draft_replies
  add column if not exists order_status text
    check (order_status in ('none', 'collecting', 'awaiting_confirmation', 'confirmed', 'paid')),
  add column if not exists order_summary text,
  add column if not exists created_at timestamptz not null default now();

create index if not exists draft_replies_business_idx on public.draft_replies (business_id);

alter table public.draft_replies enable row level security;

drop policy if exists "Owner can read their draft replies" on public.draft_replies;
create policy "Owner can read their draft replies"
  on public.draft_replies for select
  to authenticated
  using (business_id in (select public.owner_business_ids()));

drop policy if exists "Owner can delete their draft replies" on public.draft_replies;
create policy "Owner can delete their draft replies"
  on public.draft_replies for delete
  to authenticated
  using (business_id in (select public.owner_business_ids()));

-- Insert/update come from the webhook handler using the service role, which bypasses RLS, so
-- there is no owner-facing insert/update policy: the dashboard only ever reads and deletes.

notify pgrst, 'reload schema';
