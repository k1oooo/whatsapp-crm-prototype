-- 0004_auto_reply.sql
-- The automatic assistant's on/off switch per business, and the settings it reads: tone notes,
-- the legacy freeform facts box (see 0008), and after how many quiet days a lead is "cold".

alter table public.businesses
  add column if not exists auto_reply boolean not null default false,
  add column if not exists business_facts text,
  add column if not exists tone_notes text,
  add column if not exists cold_after_days integer not null default 3 check (cold_after_days > 0);

notify pgrst, 'reload schema';
