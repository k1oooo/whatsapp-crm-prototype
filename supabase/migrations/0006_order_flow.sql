DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='leads' AND column_name='order_status') THEN
    ALTER TABLE public.leads ADD COLUMN order_status text check (order_status is null or order_status in ('none', 'collecting', 'awaiting_confirmation', 'confirmed', 'paid'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='leads' AND column_name='order_summary') THEN
    ALTER TABLE public.leads ADD COLUMN order_summary text;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='businesses' AND column_name='payment_details') THEN
    ALTER TABLE public.businesses ADD COLUMN payment_details text;
  END IF;
END $$;