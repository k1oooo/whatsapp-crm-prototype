-- 0006_order_flow.sql
-- Order state on the lead, and the owner's bank details (kept separate from the knowledge base
-- so the AI can never paraphrase or invent them).

alter table public.leads
  add column if not exists order_status text
    check (order_status is null or order_status in ('none', 'collecting', 'awaiting_confirmation', 'confirmed', 'paid')),
  add column if not exists order_summary text;

alter table public.businesses
  add column if not exists payment_details text;

notify pgrst, 'reload schema';
