create table if not exists public.knowledge_entries (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  category text not null check (category in ('menu', 'location', 'hours', 'policy', 'faq', 'other')),
  title text not null,
  content text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists knowledge_entries_business_idx on public.knowledge_entries (business_id, created_at);

drop trigger if exists knowledge_entries_set_updated_at on public.knowledge_entries;
create trigger knowledge_entries_set_updated_at
  before update on public.knowledge_entries
  for each row execute function public.set_updated_at();

alter table public.knowledge_entries enable row level security;

drop policy if exists "Owner can read their knowledge base" on public.knowledge_entries;
create policy "Owner can read their knowledge base"
  on public.knowledge_entries for select
  to authenticated
  using (business_id in (select public.owner_business_ids()));

drop policy if exists "Owner can manage their knowledge base" on public.knowledge_entries;
create policy "Owner can manage their knowledge base"
  on public.knowledge_entries for all
  to authenticated
  using (business_id in (select public.owner_business_ids()))
  with check (business_id in (select public.owner_business_ids()));