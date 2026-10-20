-- Legacy digest version 1 does not record which historical wrapper produced a
-- row. A pre-025 request whose strings were already normalized has the same
-- digest as a 025/049 request, so a byte-different normalized retry cannot be
-- attributed safely. Preserve both shipped digest algorithms for exact
-- reconstruction, but upgrade only when the caller's position-less jsonb is
-- byte-equivalent to the stored digest. Ambiguous normalized-only matches fail
-- closed without rotating a token or rewriting digest metadata.

create function private.normalize_public_registration_submission_v1_025(
  p_tryout_slug text,
  p_submission jsonb
) returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  normalized_submission jsonb;
begin
  -- The current normalizer is the strict validation boundary and implements
  -- the same text/response normalization introduced by migration 025.
  normalized_submission:=private.normalize_public_registration_submission(
    p_tryout_slug,p_submission
  );

  -- Migration 025 never cast divisionId while constructing its digest. The
  -- 049 wrapper also removed positionId before delegating to it. Other UUID-
  -- looking values can only be schema select/date/text response strings and
  -- were likewise preserved by the shipped field-kind rules.
  if p_submission?'divisionId' then
    normalized_submission:=jsonb_set(
      normalized_submission,'{divisionId}',p_submission->'divisionId'
    );
  end if;
  return normalized_submission-'positionId';
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
  normalized_025_historical_submission jsonb;
  requested_position uuid;
  requested_division uuid;
  valid_key text;
  raw_historical_digest text;
  normalized_025_historical_digest text;
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

  raw_historical_submission:=p_submission-'positionId';
  normalized_submission:=private.normalize_public_registration_submission(
    p_tryout_slug,p_submission
  );
  normalized_025_historical_submission:=
    private.normalize_public_registration_submission_v1_025(
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
  normalized_025_historical_digest:=encode(
    extensions.digest(normalized_025_historical_submission::text,'sha256'),'hex'
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
      and existing_registration.submission_digest=raw_historical_digest
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
    elsif existing_registration.submission_digest_version=1
      and existing_registration.position_id is not distinct from requested_position
      and existing_registration.submission_digest=normalized_025_historical_digest
    then
      -- This match is compatible with 025/049, but it is also compatible with
      -- a normalized pre-025 row and a changed retry. Without durable era
      -- provenance it must remain an immutable conflict.
      return query select 'idempotency_conflict'::text,null::uuid,null::text;
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

revoke all on function
  private.normalize_public_registration_submission_v1_025(text,jsonb)
from public,anon,authenticated,service_role;
grant execute on function
  private.normalize_public_registration_submission_v1_025(text,jsonb)
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
