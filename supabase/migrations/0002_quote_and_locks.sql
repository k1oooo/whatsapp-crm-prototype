-- 0002_quote_and_locks.sql
-- The price the owner quoted (separate from the customer's stated budget), and the fields a
-- human corrected by hand, which the AI must never overwrite.

alter table public.leads
  add column if not exists quoted_price_myr integer check (quoted_price_myr is null or quoted_price_myr >= 0),
  add column if not exists locked_fields text[] not null default '{}';

notify pgrst, 'reload schema';
