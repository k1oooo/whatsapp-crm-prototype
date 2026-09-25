DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='leads' AND column_name='handoff_note') THEN
    ALTER TABLE public.leads ADD COLUMN handoff_note text;
  END IF;
END $$;