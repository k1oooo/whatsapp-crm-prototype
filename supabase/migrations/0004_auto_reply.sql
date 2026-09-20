-- 0004: automatic replies. Safe to run once after 0003.

-- Per business: the on/off switch and the facts the assistant may use.
alter table businesses add column if not exists auto_reply boolean not null default false;
alter table businesses add column if not exists business_facts text;

-- Per lead: why the assistant handed over, and a pause after the owner replies from their phone.
alter table leads add column if not exists human_reason text;
alter table leads add column if not exists bot_paused_until timestamptz;

-- Who wrote each message: customer, owner (WhatsApp app), bot, or dashboard.
alter table messages add column if not exists source text;
