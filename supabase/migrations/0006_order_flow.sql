-- 0006: order flow (collect details, summarise, confirm, pay). Safe to run once after 0005.

-- Where each order is: collecting, awaiting_confirmation, confirmed (waiting for payment), paid.
alter table leads add column if not exists order_status text;
alter table leads add column if not exists order_summary text;

-- Bank details, kept apart from the facts. The assistant adds them under its message
-- only after the customer confirms an order, so the numbers are never rewritten by the AI.
alter table businesses add column if not exists payment_details text;
