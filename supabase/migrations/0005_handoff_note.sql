-- 0005: what the assistant needs the owner to decide. Safe to run once after 0004.
alter table leads add column if not exists handoff_note text;
