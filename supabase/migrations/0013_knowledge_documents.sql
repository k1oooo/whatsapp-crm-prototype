-- 0013_knowledge_documents.sql
-- PDFs the owner uploads on the Knowledge base page (price lists, menus, catalogues).
-- Only the extracted text is stored, not the file, so this needs no Supabase Storage bucket and
-- stays inside the free tier. The text is appended to what the assistant reads.

create table if not exists public.knowledge_documents (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  file_name text not null,
  size_bytes integer not null default 0,
  page_count integer not null default 0,
  content text not null,
  truncated boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists knowledge_documents_business_idx
  on public.knowledge_documents (business_id, created_at);

alter table public.knowledge_documents enable row level security;

drop policy if exists "Owner can read their knowledge documents" on public.knowledge_documents;
create policy "Owner can read their knowledge documents"
  on public.knowledge_documents for select
  to authenticated
  using (business_id in (select public.owner_business_ids()));

drop policy if exists "Owner can manage their knowledge documents" on public.knowledge_documents;
create policy "Owner can manage their knowledge documents"
  on public.knowledge_documents for all
  to authenticated
  using (business_id in (select public.owner_business_ids()))
  with check (business_id in (select public.owner_business_ids()));

notify pgrst, 'reload schema';
