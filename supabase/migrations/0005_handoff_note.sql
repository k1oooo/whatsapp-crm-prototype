-- 0005_handoff_note.sql
-- The one-line note the assistant leaves for the owner when it escalates, explaining
-- what needs a decision (shown in the HandoffCard, right where the assistant stopped).

alter table public.leads
  add column handoff_note text;
