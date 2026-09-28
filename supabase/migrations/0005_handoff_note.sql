-- 0005_handoff_note.sql
-- The one-line note the assistant leaves for the owner when it escalates.

alter table public.leads
  add column if not exists handoff_note text;

notify pgrst, 'reload schema';
