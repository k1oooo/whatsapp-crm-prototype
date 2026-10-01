-- 0014_last_messages.sql
-- The inbox list needs the newest message of every chat. Reading the latest N messages for the
-- whole business and picking the newest per chat leaves older chats with no preview, so this
-- returns exactly one row per chat instead. It runs as the caller (security invoker), so the
-- existing row level security on messages still limits it to the owner's own business.

create or replace function public.last_messages(p_business_id uuid)
returns table (
  lead_id uuid,
  direction text,
  body text,
  sent_at timestamptz,
  source text
)
language sql
stable
security invoker
set search_path = public
as $$
  select distinct on (m.lead_id)
    m.lead_id, m.direction, m.body, m.sent_at, m.source
  from public.messages m
  where m.business_id = p_business_id
  order by m.lead_id, m.sent_at desc, m.created_at desc;
$$;

grant execute on function public.last_messages(uuid) to authenticated;

notify pgrst, 'reload schema';
