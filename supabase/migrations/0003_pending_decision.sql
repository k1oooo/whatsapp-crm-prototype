-- 0003_pending_decision.sql
-- The "needs you" mechanics: a flag the assistant sets when it hands a chat to the owner, why,
-- when it last chased them, and how long the assistant stays quiet after the owner replies.

alter table public.leads
  add column if not exists pending_decision boolean not null default false,
  add column if not exists human_reason text
    check (human_reason is null or human_reason in ('discount', 'stock', 'payment', 'unsure', 'feedback')),
  add column if not exists last_chased_at timestamptz,
  add column if not exists bot_paused_until timestamptz;

create index if not exists leads_business_pending_idx on public.leads (business_id, pending_decision);

notify pgrst, 'reload schema';
