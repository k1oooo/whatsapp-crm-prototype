-- 0009_self_serve_signup.sql
-- Lets a new owner create their own business row from the signup flow, before a WhatsApp
-- number is connected. Postgres unique indexes treat NULLs as distinct, so the existing
-- businesses_wa_phone_number_id_key index still stops two businesses sharing one real number.

ALTER TABLE public.businesses ALTER COLUMN wa_phone_number_id DROP NOT NULL;

drop policy if exists "Owner can create their business" on public.businesses;
create policy "Owner can create their business"
  on public.businesses for insert
  to authenticated
  with check (owner_id = (select auth.uid()));
