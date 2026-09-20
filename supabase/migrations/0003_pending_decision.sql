-- 0003: remember when you told a customer "I'll check", so you still owe them an answer.
alter table leads add column if not exists pending_decision boolean not null default false;
-- A draft that was only a "let me check" holding reply.
alter table drafts add column if not exists holding boolean not null default false;
