-- 0002: quoted price, chase tracking, and edit locks. Safe to run once after 0001.

alter table leads add column if not exists quoted_price_myr int;
alter table leads add column if not exists last_chased_at timestamptz;
-- Fields the owner corrected by hand. The AI must not overwrite these.
alter table leads add column if not exists locked_fields text[] not null default '{}';

-- Security fix: a plain view runs with its owner's rights and skips row level security,
-- which would let any logged-in user read every business's leads through the API.
-- The app does not use this view, so remove it.
drop view if exists cold_leads;
