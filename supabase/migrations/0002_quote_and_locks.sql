-- 0002_quote_and_locks.sql
-- The price the owner quoted (separate from the customer's stated budget), and the list
-- of fields a human has corrected by hand, which the AI extraction must never overwrite
-- (see mergeWithLocks() in lib/whatsapp.ts).

alter table public.leads
  add column quoted_price_myr integer check (quoted_price_myr is null or quoted_price_myr >= 0),
  add column locked_fields text[] not null default '{}';
