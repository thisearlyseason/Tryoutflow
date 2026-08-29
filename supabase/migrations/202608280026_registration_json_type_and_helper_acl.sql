-- The service-only registration boundary must reject JSON values that the
-- TypeScript schema rejects instead of allowing jsonb ->> text coercion.
create or replace function public.submit_public_registration_with_phone(
  p_tryout_slug text, p_submission jsonb, p_idempotency_key text, p_rate_key_hash text
) returns table(outcome text, registration_id uuid, confirmation_token text)
language plpgsql security definer set search_path = '' as $$
declare
  result_row record;
  normalized_submission jsonb := p_submission;
  schema_record jsonb;
  field jsonb;
  field_key text;
  field_kind text;
  answer jsonb;
  v_phone text;
begin
  if jsonb_typeof(normalized_submission) is distinct from 'object'
    or jsonb_typeof(normalized_submission -> 'givenName') is distinct from 'string'
    or jsonb_typeof(normalized_submission -> 'familyName') is distinct from 'string'
    or jsonb_typeof(normalized_submission -> 'birthDate') is distinct from 'string'
    or jsonb_typeof(normalized_submission -> 'guardianName') is distinct from 'string'
    or jsonb_typeof(normalized_submission -> 'guardianEmail') is distinct from 'string'
    or (
      normalized_submission ? 'guardianPhone'
      and (
        jsonb_typeof(normalized_submission -> 'guardianPhone') is distinct from 'string'
        or public.canonical_registration_text(normalized_submission ->> 'guardianPhone') = ''
      )
    )
  then
    raise exception 'invalid registration identity/contact types' using errcode = '22023';
  end if;

  normalized_submission := jsonb_set(
    normalized_submission,
    '{givenName}',
    to_jsonb(public.canonical_registration_text(normalized_submission ->> 'givenName'))
  );
  normalized_submission := jsonb_set(
    normalized_submission,
    '{familyName}',
    to_jsonb(public.canonical_registration_text(normalized_submission ->> 'familyName'))
  );
  normalized_submission := jsonb_set(
    normalized_submission,
    '{guardianName}',
    to_jsonb(public.canonical_registration_text(normalized_submission ->> 'guardianName'))
  );
  normalized_submission := jsonb_set(
    normalized_submission,
    '{guardianEmail}',
    to_jsonb(public.canonical_registration_text(normalized_submission ->> 'guardianEmail'))
  );
  if normalized_submission ? 'guardianPhone' then
    normalized_submission := jsonb_set(
      normalized_submission,
      '{guardianPhone}',
      to_jsonb(public.canonical_registration_text(normalized_submission ->> 'guardianPhone'))
    );
  end if;

  select version.schema into schema_record
  from public.tryouts as target
  join public.tryout_registration_form_selections as selection
    on selection.organization_id = target.organization_id and selection.tryout_id = target.id
  join public.registration_form_versions as version
    on version.organization_id = selection.organization_id
    and version.tryout_id = selection.tryout_id
    and version.id = selection.registration_form_version_id
  where target.slug = p_tryout_slug and version.status = 'published';

  if schema_record is not null and jsonb_typeof(normalized_submission -> 'responses') = 'object' then
    for field in select value from jsonb_array_elements(schema_record -> 'fields') loop
      field_key := field ->> 'key';
      field_kind := field ->> 'kind';
      answer := normalized_submission -> 'responses' -> field_key;
      if jsonb_typeof(answer) = 'string' and field_kind in ('text', 'textarea', 'email', 'phone') then
        normalized_submission := jsonb_set(
          normalized_submission,
          array['responses', field_key],
          to_jsonb(public.canonical_registration_text(answer #>> '{}'))
        );
      end if;
    end loop;
  end if;

  v_phone := case
    when normalized_submission ? 'guardianPhone'
      then normalized_submission ->> 'guardianPhone'
    else null
  end;
  if v_phone is not null and not public.is_valid_registration_phone(v_phone) then
    raise exception 'invalid guardian phone' using errcode = '22023';
  end if;
  select * into result_row from public.submit_public_registration(
    p_tryout_slug, normalized_submission, p_idempotency_key, p_rate_key_hash
  );
  if result_row.outcome = 'submitted' and v_phone is not null then
    update public.guardians as guardian set phone = v_phone
    from public.tryout_registrations as registration
    join public.athlete_guardians as link
      on link.organization_id = registration.organization_id and link.athlete_id = registration.athlete_id
    where registration.id = result_row.registration_id
      and guardian.organization_id = link.organization_id
      and guardian.id = link.guardian_id
      and guardian.phone is null;
  elsif result_row.outcome = 'replayed' then
    result_row.confirmation_token := public.rotate_registration_confirmation_token(result_row.registration_id);
  end if;
  return query select result_row.outcome, result_row.registration_id, result_row.confirmation_token;
end;
$$;

-- These are implementation helpers used by owner-executed security-definer
-- functions and constraints, not public RPCs. PostgreSQL grants EXECUTE to
-- PUBLIC on new functions unless it is revoked explicitly.
revoke all on function public.registration_whitespace_characters(),
  public.canonical_registration_text(text)
from public, anon, authenticated, service_role;
grant execute on function public.registration_whitespace_characters(),
  public.canonical_registration_text(text)
to postgres;
