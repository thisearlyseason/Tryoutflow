-- Public registration must compare athlete identity with the same NFC-aware
-- canonical form used by stored normalized columns, CSV preview/commit, and
-- the TypeScript duplicate detector. Keep the Task 10 transaction unchanged
-- apart from the two athlete-name predicates at duplicate-candidate lookup.
create or replace function public.submit_public_registration(
  p_tryout_slug text,
  p_submission jsonb,
  p_idempotency_key text,
  p_rate_key_hash text
)
returns table(outcome text,registration_id uuid,confirmation_token text)
language plpgsql
security definer
set search_path=''
as $$
declare
  target public.tryouts%rowtype;
  version public.registration_form_versions%rowtype;
  selected_division uuid;
  athlete uuid;
  guardian uuid;
  registration uuid;
  raw_token text;
  field jsonb;
  answer jsonb;
  answer_text text;
  v_given_name text;
  v_family_name text;
  v_guardian_name text;
  v_guardian_email text;
  v_guardian_phone text;
  v_birth_date date;
  valid_key text;
  payload_digest text;
  attempts_after integer;
begin
  if p_tryout_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
    or p_idempotency_key !~ '^[A-Za-z0-9_-]{24,200}$'
    or p_rate_key_hash !~ '^[0-9a-f]{64}$'
    or jsonb_typeof(p_submission)<>'object'
  then
    raise exception 'invalid public registration request' using errcode='22023';
  end if;
  if exists(
    select 1 from jsonb_object_keys(p_submission) key
    where key not in(
      'givenName','familyName','birthDate','guardianName','guardianEmail',
      'guardianPhone','divisionId','responses'
    )
  ) then
    raise exception 'unknown registration field' using errcode='22023';
  end if;

  select * into target
  from public.tryouts
  where slug=p_tryout_slug
    and status='published'
    and registration_starts_at<=clock_timestamp()
    and registration_ends_at>clock_timestamp()
  for update;
  if not found then
    return query select 'registration_closed'::text,null::uuid,null::text;
    return;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(target.id::text||':'||p_idempotency_key,0)
  );
  valid_key:=encode(extensions.digest(p_idempotency_key,'sha256'),'hex');
  payload_digest:=encode(extensions.digest(p_submission::text,'sha256'),'hex');
  select id into registration
  from public.tryout_registrations
  where organization_id=target.organization_id
    and tryout_id=target.id
    and submission_key_digest=valid_key
    and submission_digest=payload_digest;
  if found then
    return query select 'replayed'::text,registration,null::text;
    return;
  end if;
  if exists(
    select 1 from public.tryout_registrations
    where organization_id=target.organization_id
      and tryout_id=target.id
      and submission_key_digest=valid_key
  ) then
    return query select 'idempotency_conflict'::text,null::uuid,null::text;
    return;
  end if;

  with expired as(
    select key_hash from public.registration_rate_counters
    where expires_at<=clock_timestamp()
    order by expires_at limit 100
  )
  delete from public.registration_rate_counters
  where key_hash in(select key_hash from expired);
  insert into public.registration_rate_counters(
    key_hash,attempts,window_started_at,expires_at
  ) values(
    p_rate_key_hash,1,clock_timestamp(),clock_timestamp()+interval '10 minutes'
  )
  on conflict(key_hash) do update set
    attempts=case
      when public.registration_rate_counters.expires_at<=clock_timestamp() then 1
      else public.registration_rate_counters.attempts+1
    end,
    window_started_at=case
      when public.registration_rate_counters.expires_at<=clock_timestamp() then clock_timestamp()
      else public.registration_rate_counters.window_started_at
    end,
    expires_at=case
      when public.registration_rate_counters.expires_at<=clock_timestamp()
        then clock_timestamp()+interval '10 minutes'
      else public.registration_rate_counters.expires_at
    end
  returning attempts into attempts_after;
  if attempts_after>10 then
    return query select 'rate_limited'::text,null::uuid,null::text;
    return;
  end if;

  select form_version.* into version
  from public.tryout_registration_form_selections selection
  join public.registration_form_versions form_version
    on form_version.organization_id=selection.organization_id
    and form_version.tryout_id=selection.tryout_id
    and form_version.id=selection.registration_form_version_id
  where selection.organization_id=target.organization_id
    and selection.tryout_id=target.id
    and form_version.status='published'
  for update of selection,form_version;
  if not found then
    return query select 'registration_closed'::text,null::uuid,null::text;
    return;
  end if;

  v_given_name:=trim(coalesce(p_submission->>'givenName',''));
  v_family_name:=trim(coalesce(p_submission->>'familyName',''));
  v_guardian_name:=trim(coalesce(p_submission->>'guardianName',''));
  v_guardian_email:=public.normalize_registration_text(
    coalesce(p_submission->>'guardianEmail','')
  );
  v_guardian_phone:=trim(coalesce(p_submission->>'guardianPhone',''));
  if not public.is_valid_registration_calendar_date(p_submission->>'birthDate') then
    raise exception 'invalid birth date' using errcode='22023';
  end if;
  v_birth_date:=(p_submission->>'birthDate')::date;
  if char_length(v_given_name) not between 1 and 120
    or char_length(v_family_name) not between 1 and 120
    or char_length(v_guardian_name) not between 1 and 160
    or not public.is_valid_registration_email(v_guardian_email)
    or (
      v_guardian_phone<>''
      and not public.is_valid_registration_phone(v_guardian_phone)
    )
    or v_birth_date>current_date
  then
    raise exception 'invalid identity' using errcode='22023';
  end if;
  if jsonb_typeof(p_submission->'responses')<>'object'
    or octet_length((p_submission->'responses')::text)>32768
  then
    raise exception 'invalid responses' using errcode='22023';
  end if;
  if exists(
    select 1 from jsonb_object_keys(p_submission->'responses') response_key
    where not exists(
      select 1 from jsonb_array_elements(version.schema->'fields') schema_field
      where schema_field->>'key'=response_key
    )
  ) then
    raise exception 'unknown registration response' using errcode='22023';
  end if;

  for field in select value from jsonb_array_elements(version.schema->'fields') loop
    answer:=p_submission->'responses'->(field->>'key');
    if (field->>'required')::boolean and (
      answer is null
      or answer='null'::jsonb
      or (jsonb_typeof(answer)='string' and trim(answer#>>'{}')='')
    ) then
      raise exception 'required response missing' using errcode='22023';
    end if;
    if answer is null or answer='null'::jsonb then continue; end if;
    if field->>'kind' in('checkbox','consent') then
      if jsonb_typeof(answer)<>'boolean'
        or (
          field->>'kind'='consent'
          and (field->>'required')::boolean
          and answer<>'true'::jsonb
        )
      then
        raise exception 'invalid response' using errcode='22023';
      end if;
      continue;
    end if;
    if jsonb_typeof(answer)<>'string' then
      raise exception 'invalid response' using errcode='22023';
    end if;
    answer_text:=answer#>>'{}';
    case field->>'kind'
      when 'text' then
        if char_length(trim(answer_text))>500 then
          raise exception 'invalid response' using errcode='22023';
        end if;
      when 'textarea' then
        if char_length(trim(answer_text))>5000 then
          raise exception 'invalid response' using errcode='22023';
        end if;
      when 'email' then
        if not public.is_valid_registration_email(answer_text) then
          raise exception 'invalid response' using errcode='22023';
        end if;
      when 'phone' then
        if not public.is_valid_registration_phone(answer_text) then
          raise exception 'invalid response' using errcode='22023';
        end if;
      when 'date' then
        if not public.is_valid_registration_calendar_date(answer_text) then
          raise exception 'invalid response' using errcode='22023';
        end if;
      when 'select' then
        if not ((field->'options')?answer_text) then
          raise exception 'invalid response' using errcode='22023';
        end if;
      else
        raise exception 'invalid response kind' using errcode='22023';
    end case;
  end loop;

  selected_division:=nullif(p_submission->>'divisionId','')::uuid;
  if selected_division is null then
    select id into selected_division
    from public.tryout_divisions
    where organization_id=target.organization_id and tryout_id=target.id
    order by sort_order limit 1;
  end if;
  if not exists(
    select 1 from public.tryout_divisions
    where organization_id=target.organization_id
      and tryout_id=target.id
      and id=selected_division
  ) then
    raise exception 'invalid division' using errcode='22023';
  end if;

  insert into public.athletes(
    organization_id,given_name,family_name,
    normalized_given_name,normalized_family_name,birth_date
  ) values(
    target.organization_id,v_given_name,v_family_name,
    public.normalize_registration_text(v_given_name),
    public.normalize_registration_text(v_family_name),v_birth_date
  ) returning id into athlete;
  insert into public.guardians(organization_id,name,email,normalized_email)
  values(target.organization_id,v_guardian_name,v_guardian_email,v_guardian_email)
  returning id into guardian;
  insert into public.athlete_guardians(organization_id,athlete_id,guardian_id)
  values(target.organization_id,athlete,guardian);
  insert into public.tryout_registrations(
    organization_id,tryout_id,athlete_id,division_id,
    registration_form_version_id,responses,submission_key_digest,submission_digest
  ) values(
    target.organization_id,target.id,athlete,selected_division,version.id,
    p_submission->'responses',valid_key,payload_digest
  ) returning id into registration;
  insert into public.session_enrollments(
    organization_id,tryout_id,registration_id,session_id
  )
  select target.organization_id,target.id,registration,session.id
  from public.tryout_sessions session
  where session.organization_id=target.organization_id
    and session.tryout_id=target.id
    and session.division_id=selected_division;
  insert into public.registration_duplicate_candidates(
    organization_id,registration_id,candidate_athlete_id,reason
  )
  select target.organization_id,registration,candidate.id,
    'name_birthdate_guardian_email'
  from public.athletes candidate
  join public.athlete_guardians link
    on link.organization_id=candidate.organization_id
    and link.athlete_id=candidate.id
  join public.guardians candidate_guardian
    on candidate_guardian.organization_id=link.organization_id
    and candidate_guardian.id=link.guardian_id
  where candidate.organization_id=target.organization_id
    and candidate.id<>athlete
    and candidate.normalized_given_name=
      lower(public.canonical_import_text(v_given_name))
    and candidate.normalized_family_name=
      lower(public.canonical_import_text(v_family_name))
    and candidate.birth_date=v_birth_date
    and candidate_guardian.normalized_email=v_guardian_email;

  raw_token:=encode(extensions.gen_random_bytes(32),'hex');
  update public.registration_confirmation_tokens confirmation
  set revoked_at=clock_timestamp()
  where confirmation.organization_id=target.organization_id
    and confirmation.registration_id=registration
    and confirmation.purpose='registration_confirmation'
    and confirmation.used_at is null
    and confirmation.revoked_at is null;
  insert into public.registration_confirmation_tokens(
    organization_id,registration_id,token_digest,expires_at
  ) values(
    target.organization_id,registration,
    encode(extensions.digest(raw_token,'sha256'),'hex'),
    clock_timestamp()+interval '7 days'
  );
  return query select 'submitted'::text,registration,raw_token;
end;
$$;

-- CREATE OR REPLACE preserves ACLs, but restate the intended boundary so an
-- upgrade from any supported earlier state cannot expose the base function.
revoke all on function public.submit_public_registration(text,jsonb,text,text)
from public,anon,authenticated,service_role;
grant execute on function public.submit_public_registration(text,jsonb,text,text)
to postgres;
