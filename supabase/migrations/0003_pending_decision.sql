DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='leads' AND column_name='pending_decision') THEN
    ALTER TABLE public.leads ADD COLUMN pending_decision boolean not null default false;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='leads' AND column_name='human_reason') THEN
    ALTER TABLE public.leads ADD COLUMN human_reason text check (human_reason is null or human_reason in ('discount', 'stock', 'payment', 'unsure', 'feedback'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='leads' AND column_name='last_chased_at') THEN
    ALTER TABLE public.leads ADD COLUMN last_chased_at timestamptz;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='leads' AND column_name='bot_paused_until') THEN
    ALTER TABLE public.leads ADD COLUMN bot_paused_until timestamptz;
  END IF;
END $$;

create index if not exists leads_business_pending_idx on public.leads (business_id, pending_decision);