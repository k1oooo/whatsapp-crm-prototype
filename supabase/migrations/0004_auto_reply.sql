-- 0004_auto_reply.sql
-- Turns the automatic assistant on/off per business, and the settings it reads:
-- the owner's tone notes, the (now legacy, see 0008) freeform facts box, and after
-- how many quiet days an open lead counts as "cold" in the pipeline board.

alter table public.businesses
  add column auto_reply boolean not null default false,
  add column business_facts text,
  add column tone_notes text,
  add column cold_after_days integer not null default 3 check (cold_after_days > 0);
