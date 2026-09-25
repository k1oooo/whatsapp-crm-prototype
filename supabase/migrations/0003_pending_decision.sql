-- 0003_pending_decision.sql
-- The "needs you" mechanics: a flag the assistant sets when it hands a chat to the owner,
-- why, when it last chased them for an answer, and how long the assistant stays quiet
-- after the owner replies from their own WhatsApp app (see PAUSE_MS in lib/whatsapp.ts).

alter table public.leads
  add column pending_decision boolean not null default false,
  add column human_reason text
    check (human_reason is null or human_reason in ('discount', 'stock', 'payment', 'unsure', 'feedback')),
  add column last_chased_at timestamptz,
  add column bot_paused_until timestamptz;

-- The inbox list always sorts "needs you" chats first.
create index leads_business_pending_idx on public.leads (business_id, pending_decision);
