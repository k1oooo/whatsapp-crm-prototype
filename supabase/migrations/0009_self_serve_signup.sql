-- 0009_self_serve_signup.sql
-- Lets a new owner create their own business row from the signup flow, before a WhatsApp number
-- is connected. Unique indexes treat NULLs as distinct, so businesses_wa_phone_number_id_key
-- still stops two businesses sharing one real number.

alter table public.businesses alter column wa_phone_number_id drop not null;

drop policy if exists "Owner can create their business" on public.businesses;
create policy "Owner can create their business"
  on public.businesses for insert
  to authenticated
  with check (owner_id = (select auth.uid()));

notify pgrst, 'reload schema';
