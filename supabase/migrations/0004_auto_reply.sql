DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='businesses' AND column_name='auto_reply') THEN
    ALTER TABLE public.businesses ADD COLUMN auto_reply boolean not null default false;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='businesses' AND column_name='business_facts') THEN
    ALTER TABLE public.businesses ADD COLUMN business_facts text;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='businesses' AND column_name='tone_notes') THEN
    ALTER TABLE public.businesses ADD COLUMN tone_notes text;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='businesses' AND column_name='cold_after_days') THEN
    ALTER TABLE public.businesses ADD COLUMN cold_after_days integer not null default 3 check (cold_after_days > 0);
  END IF;
END $$;