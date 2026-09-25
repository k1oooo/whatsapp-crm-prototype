-- 0008_knowledge_base.sql
-- Structured facts the assistant is allowed to answer from (see lib/knowledge.ts).
-- Replaces the single freeform businesses.business_facts box, which now holds only the
-- leftover "Other notes" once a business has knowledge entries.

create table public.knowledge_entries (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  category text not null check (category in ('menu', 'location', 'hours', 'policy', 'faq', 'other')),
  title text not null,
  content text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index knowledge_entries_business_idx on public.knowledge_entries (business_id, created_at);

create trigger knowledge_entries_set_updated_at
  before update on public.knowledge_entries
  for each row execute function public.set_updated_at();

alter table public.knowledge_entries enable row level security;

create policy "Owner can read their knowledge base"
  on public.knowledge_entries for select
  to authenticated
  using (business_id in (select public.owner_business_ids()));

create policy "Owner can manage their knowledge base"
  on public.knowledge_entries for all
  to authenticated
  using (business_id in (select public.owner_business_ids()))
  with check (business_id in (select public.owner_business_ids()));
