-- 0006_order_flow.sql
-- Order state on the lead (see OrderStatus in lib/ai.ts), and the owner's bank details,
-- kept in their own column, separate from the knowledge base, so the AI can never
-- paraphrase or invent them: the system appends them verbatim after "confirmed".

alter table public.leads
  add column order_status text
    check (order_status is null or order_status in ('none', 'collecting', 'awaiting_confirmation', 'confirmed', 'paid')),
  add column order_summary text;

alter table public.businesses
  add column payment_details text;
