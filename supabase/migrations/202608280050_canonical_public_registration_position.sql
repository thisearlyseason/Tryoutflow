-- Registration position is part of the idempotent command, not a mutable
-- post-processing attribute. Existing rows retain digest version 1 until an
-- exact legacy replay proves both the old normalized payload and stored
-- position; that replay upgrades the row atomically to version 2. A position
-- introduced or changed on a legacy key is always a conflict.

alter table public.tryout_registrations
  add column submission_digest_version smallint not null default 1,
  add constraint tryout_registrations_submission_digest_version_check
    check (submission_digest_version in (1,2));

create function private.normalize_public_registration_submission(
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
  raw_position text;
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
    for field in select value from jsonb_array_elements(schema_record->'fields') loop
      field_key:=field->>'key';
      field_kind:=field->>'kind';
      answer:=normalized_submission->'responses'->field_key;
      if jsonb_typeof(answer)='string'
        and field_kind in ('text','textarea','email','phone')
      then
        normalized_submission:=jsonb_set(
          normalized_submission,array['responses',field_key],
          to_jsonb(public.canonical_registration_text(answer#>>'{}'))
        );
      end if;
    end loop;
  end if;
  return normalized_submission;
end;
$$;

create function public.submit_public_registration_v2(
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
  requested_position uuid;
  valid_key text;
  legacy_digest text;
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
  normalized_submission:=private.normalize_public_registration_submission(
    p_tryout_slug,p_submission
  );
  requested_position:=nullif(normalized_submission->>'positionId','')::uuid;
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

  perform pg_advisory_xact_lock(
    hashtextextended(target_tryout::text||':'||p_idempotency_key,0)
  );
  valid_key:=encode(extensions.digest(p_idempotency_key,'sha256'),'hex');
  legacy_digest:=encode(extensions.digest(internal_submission::text,'sha256'),'hex');
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
      and existing_registration.submission_digest=legacy_digest
      and existing_registration.position_id is not distinct from requested_position
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

-- Upgrade ACL rule: exactly one service-role submission entry point. Legacy
-- functions remain only for postgres-owned internal composition and for safe
-- replay of version-one rows; PostgREST cannot call them.
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
