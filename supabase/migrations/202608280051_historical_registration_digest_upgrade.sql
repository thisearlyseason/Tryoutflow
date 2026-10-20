-- Version-one registration rows were produced by two shipped digest rules.
-- Migration 024 hashed the incoming position-less jsonb directly; jsonb made
-- object ordering/spacing canonical while preserving string values. Migration
-- 025 normalized canonicalizable identity, contact, and dynamic text values
-- before the same hash. Migration 049 delegated to that 025 wrapper, so it did
-- not introduce a third digest rule. The canonical v2 boundary validates the
-- complete request before comparing either historical candidate.

create or replace function private.normalize_public_registration_submission(
  p_tryout_slug text,
  p_submission jsonb
) returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  normalized_submission jsonb:=p_submission;
  schema_record jsonb;
  field jsonb;
  field_key text;
  field_kind text;
  answer jsonb;
  answer_text text;
  raw_position text;
  raw_division text;
begin
  if jsonb_typeof(normalized_submission) is distinct from 'object'
    or jsonb_typeof(normalized_submission->'givenName') is distinct from 'string'
    or jsonb_typeof(normalized_submission->'familyName') is distinct from 'string'
    or jsonb_typeof(normalized_submission->'birthDate') is distinct from 'string'
    or jsonb_typeof(normalized_submission->'guardianName') is distinct from 'string'
    or jsonb_typeof(normalized_submission->'guardianEmail') is distinct from 'string'
    or jsonb_typeof(normalized_submission->'responses') is distinct from 'object'
    or (
      normalized_submission?'guardianPhone'
      and (
        jsonb_typeof(normalized_submission->'guardianPhone') is distinct from 'string'
        or public.canonical_registration_text(normalized_submission->>'guardianPhone')=''
      )
    )
    or (
      normalized_submission?'divisionId'
      and jsonb_typeof(normalized_submission->'divisionId') is distinct from 'string'
    )
    or (
      normalized_submission?'positionId'
      and normalized_submission->'positionId'<>'null'::jsonb
      and jsonb_typeof(normalized_submission->'positionId') is distinct from 'string'
    )
  then
    raise exception 'invalid registration identity/contact types' using errcode='22023';
  end if;
  if exists(
    select 1 from jsonb_object_keys(normalized_submission) key
    where key not in(
      'givenName','familyName','birthDate','guardianName','guardianEmail',
      'guardianPhone','divisionId','positionId','responses'
    )
  ) then
    raise exception 'unknown registration field' using errcode='22023';
  end if;
  if octet_length((normalized_submission->'responses')::text)>32768 then
    raise exception 'invalid registration responses' using errcode='22023';
  end if;

  if normalized_submission?'divisionId' then
    raw_division:=normalized_submission->>'divisionId';
    if raw_division !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      raise exception 'invalid registration division' using errcode='22023';
    end if;
    normalized_submission:=jsonb_set(
      normalized_submission,'{divisionId}',to_jsonb((raw_division::uuid)::text)
    );
  end if;
  if normalized_submission?'positionId'
    and normalized_submission->'positionId'<>'null'::jsonb
  then
    raw_position:=normalized_submission->>'positionId';
    if raw_position !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      raise exception 'invalid registration position' using errcode='22023';
    end if;
    normalized_submission:=jsonb_set(
      normalized_submission,'{positionId}',to_jsonb((raw_position::uuid)::text)
    );
  else
    normalized_submission:=normalized_submission||jsonb_build_object('positionId',null);
  end if;

  normalized_submission:=jsonb_set(
    normalized_submission,'{givenName}',
    to_jsonb(public.canonical_registration_text(normalized_submission->>'givenName'))
  );
  normalized_submission:=jsonb_set(
    normalized_submission,'{familyName}',
    to_jsonb(public.canonical_registration_text(normalized_submission->>'familyName'))
  );
  normalized_submission:=jsonb_set(
    normalized_submission,'{guardianName}',
    to_jsonb(public.canonical_registration_text(normalized_submission->>'guardianName'))
  );
  normalized_submission:=jsonb_set(
    normalized_submission,'{guardianEmail}',
    to_jsonb(public.canonical_registration_text(normalized_submission->>'guardianEmail'))
  );
  if normalized_submission?'guardianPhone' then
    normalized_submission:=jsonb_set(
      normalized_submission,'{guardianPhone}',
      to_jsonb(public.canonical_registration_text(normalized_submission->>'guardianPhone'))
    );
  end if;

  if char_length(normalized_submission->>'givenName') not between 1 and 120
    or char_length(normalized_submission->>'familyName') not between 1 and 120
    or char_length(normalized_submission->>'guardianName') not between 1 and 160
    or not public.is_valid_registration_email(normalized_submission->>'guardianEmail')
    or (
      normalized_submission?'guardianPhone'
      and not public.is_valid_registration_phone(normalized_submission->>'guardianPhone')
    )
    or not public.is_valid_registration_calendar_date(normalized_submission->>'birthDate')
    or (normalized_submission->>'birthDate')::date>current_date
  then
    raise exception 'invalid registration identity/contact values' using errcode='22023';
  end if;

  select version.schema into schema_record
  from public.tryouts target
  join public.tryout_registration_form_selections selection
    on selection.organization_id=target.organization_id and selection.tryout_id=target.id
  join public.registration_form_versions version
    on version.organization_id=selection.organization_id
    and version.tryout_id=selection.tryout_id
    and version.id=selection.registration_form_version_id
  where target.slug=p_tryout_slug and version.status='published';

  if schema_record is not null then
    if exists(
      select 1 from jsonb_object_keys(normalized_submission->'responses') response_key
      where not exists(
        select 1 from jsonb_array_elements(schema_record->'fields') schema_field
        where schema_field->>'key'=response_key
      )
    ) then
      raise exception 'unknown registration response' using errcode='22023';
    end if;
    for field in select value from jsonb_array_elements(schema_record->'fields') loop
      field_key:=field->>'key';
      field_kind:=field->>'kind';
      answer:=normalized_submission->'responses'->field_key;
      if (field->>'required')::boolean and (
        answer is null or answer='null'::jsonb
        or (
          jsonb_typeof(answer)='string'
          and public.canonical_registration_text(answer#>>'{}')=''
        )
      ) then
        raise exception 'required registration response missing' using errcode='22023';
      end if;
      if answer is null or answer='null'::jsonb then continue; end if;
      if field_kind in('checkbox','consent') then
        if jsonb_typeof(answer)<>'boolean'
          or (
            field_kind='consent' and (field->>'required')::boolean
            and answer<>'true'::jsonb
          )
        then
          raise exception 'invalid registration response' using errcode='22023';
        end if;
        continue;
      end if;
      if jsonb_typeof(answer)<>'string' then
        raise exception 'invalid registration response' using errcode='22023';
      end if;
      answer_text:=answer#>>'{}';
      if field_kind in('text','textarea','email','phone') then
        answer_text:=public.canonical_registration_text(answer_text);
        normalized_submission:=jsonb_set(
          normalized_submission,array['responses',field_key],to_jsonb(answer_text)
        );
      end if;
      case field_kind
        when 'text' then
          if char_length(answer_text)>500 then
            raise exception 'invalid registration response' using errcode='22023';
          end if;
        when 'textarea' then
          if char_length(answer_text)>5000 then
            raise exception 'invalid registration response' using errcode='22023';
          end if;
        when 'email' then
          if not public.is_valid_registration_email(answer_text) then
            raise exception 'invalid registration response' using errcode='22023';
          end if;
        when 'phone' then
          if not public.is_valid_registration_phone(answer_text) then
            raise exception 'invalid registration response' using errcode='22023';
          end if;
        when 'date' then
          if not public.is_valid_registration_calendar_date(answer_text) then
            raise exception 'invalid registration response' using errcode='22023';
          end if;
        when 'select' then
          if not ((field->'options')?answer_text) then
            raise exception 'invalid registration response' using errcode='22023';
          end if;
        else
          raise exception 'invalid registration response kind' using errcode='22023';
      end case;
    end loop;
  end if;
  return normalized_submission;
end;
$$;

create or replace function public.submit_public_registration_v2(
  p_tryout_slug text,
  p_submission jsonb,
  p_idempotency_key text,
  p_rate_key_hash text
) returns table(outcome text,registration_id uuid,confirmation_token text)
language plpgsql
security definer
set search_path=''
as $$
declare
  target_tryout uuid;
  target_organization uuid;
  normalized_submission jsonb;
  internal_submission jsonb;
  raw_historical_submission jsonb;
  requested_position uuid;
  requested_division uuid;
  valid_key text;
  raw_historical_digest text;
  normalized_historical_digest text;
  canonical_digest text;
  existing_registration public.tryout_registrations%rowtype;
  result_row record;
begin
  if p_tryout_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
    or p_idempotency_key !~ '^[A-Za-z0-9_-]{24,200}$'
    or p_rate_key_hash !~ '^[0-9a-f]{64}$'
  then
    raise exception 'invalid public registration request' using errcode='22023';
  end if;

  -- Keep the original position-less jsonb for the exact migration-024 digest.
  -- Validation and normalization must finish before either candidate is used.
  raw_historical_submission:=p_submission-'positionId';
  normalized_submission:=private.normalize_public_registration_submission(
    p_tryout_slug,p_submission
  );
  requested_position:=nullif(normalized_submission->>'positionId','')::uuid;
  requested_division:=nullif(normalized_submission->>'divisionId','')::uuid;
  internal_submission:=normalized_submission-'positionId';

  select target.id,target.organization_id into target_tryout,target_organization
  from public.tryouts target
  where target.slug=p_tryout_slug
    and target.status='published'
    and target.registration_starts_at<=clock_timestamp()
    and target.registration_ends_at>clock_timestamp()
  for update;
  if not found then
    return query select 'registration_closed'::text,null::uuid,null::text;
    return;
  end if;
  if requested_position is not null and not exists(
    select 1 from public.tryout_positions position
    where position.organization_id=target_organization
      and position.tryout_id=target_tryout
      and position.id=requested_position
  ) then
    raise exception 'invalid registration position' using errcode='22023';
  end if;
  if requested_division is not null and not exists(
    select 1 from public.tryout_divisions division
    where division.organization_id=target_organization
      and division.tryout_id=target_tryout
      and division.id=requested_division
  ) then
    raise exception 'invalid registration division' using errcode='22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(target_tryout::text||':'||p_idempotency_key,0)
  );
  valid_key:=encode(extensions.digest(p_idempotency_key,'sha256'),'hex');
  raw_historical_digest:=encode(
    extensions.digest(raw_historical_submission::text,'sha256'),'hex'
  );
  normalized_historical_digest:=encode(
    extensions.digest(internal_submission::text,'sha256'),'hex'
  );
  canonical_digest:=encode(extensions.digest(
    jsonb_build_object(
      'digestVersion',2,
      'tryoutId',target_tryout,
      'idempotencyKeyDigest',valid_key,
      'submission',normalized_submission
    )::text,'sha256'
  ),'hex');

  select registration.* into existing_registration
  from public.tryout_registrations registration
  where registration.organization_id=target_organization
    and registration.tryout_id=target_tryout
    and registration.submission_key_digest=valid_key
  for update;
  if found then
    if existing_registration.submission_digest_version=1
      and existing_registration.position_id is not distinct from requested_position
      and existing_registration.submission_digest in(
        raw_historical_digest,normalized_historical_digest
      )
    then
      update public.tryout_registrations registration set
        submission_digest=canonical_digest,
        submission_digest_version=2
      where registration.organization_id=target_organization
        and registration.tryout_id=target_tryout
        and registration.id=existing_registration.id;
      return query select 'replayed'::text,existing_registration.id,
        public.rotate_registration_confirmation_token(existing_registration.id);
      return;
    elsif existing_registration.submission_digest_version=2
      and existing_registration.submission_digest=canonical_digest
      and existing_registration.position_id is not distinct from requested_position
    then
      return query select 'replayed'::text,existing_registration.id,
        public.rotate_registration_confirmation_token(existing_registration.id);
      return;
    end if;
    return query select 'idempotency_conflict'::text,null::uuid,null::text;
    return;
  end if;

  select * into result_row from public.submit_public_registration_with_phone(
    p_tryout_slug,internal_submission,p_idempotency_key,p_rate_key_hash
  );
  if result_row.outcome<>'submitted' then
    return query select result_row.outcome,result_row.registration_id,
      result_row.confirmation_token;
    return;
  end if;
  update public.tryout_registrations registration set
    position_id=requested_position,
    submission_digest=canonical_digest,
    submission_digest_version=2
  where registration.organization_id=target_organization
    and registration.tryout_id=target_tryout
    and registration.id=result_row.registration_id;
  insert into public.audit_logs(
    organization_id,actor_user_id,action,entity_type,entity_id,details
  ) values(
    target_organization,null,'registration.submitted','tryout_registration',
    result_row.registration_id,
    jsonb_build_object(
      'tryoutId',target_tryout,
      'positionId',requested_position,
      'source','public'
    )
  );
  return query select result_row.outcome,result_row.registration_id,
    result_row.confirmation_token;
end;
$$;

revoke all on function private.normalize_public_registration_submission(text,jsonb)
from public,anon,authenticated,service_role;
grant execute on function private.normalize_public_registration_submission(text,jsonb)
to postgres;

revoke all on function public.submit_public_registration(text,jsonb,text,text),
  public.submit_public_registration_with_phone(text,jsonb,text,text),
  public.submit_public_registration_with_position(text,jsonb,text,text,uuid),
  public.submit_public_registration_v2(text,jsonb,text,text)
from public,anon,authenticated,service_role;
grant execute on function public.submit_public_registration(text,jsonb,text,text),
  public.submit_public_registration_with_phone(text,jsonb,text,text),
  public.submit_public_registration_with_position(text,jsonb,text,text,uuid),
  public.submit_public_registration_v2(text,jsonb,text,text)
to postgres;
grant execute on function public.submit_public_registration_v2(text,jsonb,text,text)
to service_role;
