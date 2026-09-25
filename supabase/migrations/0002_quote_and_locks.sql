DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='leads' AND column_name='quoted_price_myr') THEN
    ALTER TABLE public.leads ADD COLUMN quoted_price_myr integer check (quoted_price_myr is null or quoted_price_myr >= 0);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='leads' AND column_name='locked_fields') THEN
    ALTER TABLE public.leads ADD COLUMN locked_fields text[] not null default '{}';
  END IF;
END $$;