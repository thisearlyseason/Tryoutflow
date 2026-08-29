-- Additive wrapper: preserve the proven registration transaction while attaching
-- an optional phone only to the newly-created guardian. Replays never overwrite
-- a previously stored guardian contact.
create function public.submit_public_registration_with_phone(p_tryout_slug text,p_submission jsonb,p_idempotency_key text,p_rate_key_hash text)
returns table(outcome text,registration_id uuid,confirmation_token text)
language plpgsql security definer set search_path='' as $$
declare result_row record; v_phone text;
begin
  v_phone:=nullif(regexp_replace(trim(coalesce(p_submission->>'guardianPhone','')), '\\s+', ' ', 'g'),'');
  if v_phone is not null and v_phone !~ '^[+]?[0-9 ()-]{7,32}$' then raise exception 'invalid guardian phone' using errcode='22023'; end if;
  select * into result_row from public.submit_public_registration(p_tryout_slug,p_submission,p_idempotency_key,p_rate_key_hash);
  if result_row.outcome='submitted' and v_phone is not null then
    update public.guardians guardian set phone=v_phone
    from public.tryout_registrations registration join public.athlete_guardians link on link.organization_id=registration.organization_id and link.athlete_id=registration.athlete_id
    where registration.id=result_row.registration_id and guardian.organization_id=link.organization_id and guardian.id=link.guardian_id and guardian.phone is null;
  end if;
  return query select result_row.outcome,result_row.registration_id,result_row.confirmation_token;
end; $$;
revoke all on function public.submit_public_registration_with_phone(text,jsonb,text,text) from public,anon,authenticated;
grant execute on function public.submit_public_registration_with_phone(text,jsonb,text,text) to service_role;
