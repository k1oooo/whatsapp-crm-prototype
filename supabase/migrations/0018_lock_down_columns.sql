-- 0018: column level write limits.
--
-- Owners talk to Supabase straight from the browser (the anon key is public), so they can send any
-- UPDATE the row level security policies allow, not just the ones the app's server actions send.
-- RLS only checks WHOSE row it is, not WHICH columns change. That let an owner:
--   * point businesses.wa_phone_number_id at a number they do not own (the server action's proof of
--     ownership, checkPhoneNumberAccess, is skipped), set wa_connection_type = 'embedded', and so
--     receive another business's webhook traffic, or block its connection;
--   * change leads.wa_contact_number, or repoint follow_ups.lead_id at another business's lead.
--
-- From now on the browser session can only write the columns below. The WhatsApp connection columns
-- (wa_phone_number_id, wa_access_token, wa_app_secret, wa_verify_token, wa_connection_type, wa_waba_id,
-- wa_register_pin) are written by the server with the service role, after it has checked ownership.
--
-- Column privileges are not inherited by columns added later: a new column is read only for owners
-- until a migration grants it here. That is the point. Safe to run more than once.

/* ---------- businesses ---------- */
revoke insert, update on public.businesses from authenticated;
grant insert (owner_id, name) on public.businesses to authenticated;
grant update (
  name, wa_owner_number, auto_reply, business_facts, tone_notes, cold_after_days,
  payment_details, reply_mode, follow_up_settings
) on public.businesses to authenticated;

/* ---------- leads ---------- */
-- Not writable by an owner: id, business_id, wa_contact_number, language, last_inbound_at, created_at.
revoke update on public.leads from authenticated;
grant update (
  name, need, budget_myr, quoted_price_myr, deadline, stage, locked_fields,
  last_message_at, last_outbound_at, last_chased_at, updated_at,
  pending_decision, human_reason, handoff_note, bot_paused_until,
  order_status, order_summary, order_lines, order_total_myr, paid_at,
  follow_up_consent, consent_asked_at, awaiting_feedback
) on public.leads to authenticated;

/* ---------- follow_ups ---------- */
-- Not writable by an owner: id, business_id, lead_id, kind, template_name, campaign, order_key, created_at.
revoke update on public.follow_ups from authenticated;
grant update (status, detail, due_at, claimed_at, sent_at, body) on public.follow_ups to authenticated;

-- The insert policy already requires the lead to belong to the business. The update policy did not.
drop policy if exists "Owner can update their follow-ups" on public.follow_ups;
create policy "Owner can update their follow-ups"
  on public.follow_ups for update
  to authenticated
  using (business_id in (select public.owner_business_ids()))
  with check (
    business_id in (select public.owner_business_ids())
    and exists (
      select 1 from public.leads l
      where l.id = lead_id and l.business_id = follow_ups.business_id
    )
  );

notify pgrst, 'reload schema';
