-- Keep public registration validation identical at the TypeScript and database
-- boundaries. PostgreSQL char_length counts Unicode code points, matching the
-- application validator's Array.from(value).length behavior.
create function public.is_valid_registration_email(value text)
returns boolean language sql immutable set search_path = '' as $$
  select value is not null
    and char_length(trim(value)) between 3 and 254
    and trim(value) ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$';
$$;

create function public.is_valid_registration_phone(value text)
returns boolean language sql immutable set search_path = '' as $$
  select value is not null
    and char_length(trim(value)) between 7 and 32
    and trim(value) ~ '^[+]?[0-9 ()-]+$'
    and char_length(regexp_replace(trim(value), '[^0-9]', '', 'g')) between 7 and 15;
$$;

create function public.is_valid_registration_calendar_date(value text)
returns boolean language plpgsql immutable set search_path = '' as $$
declare parsed date;
begin
  if value is null or value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or left(value, 4) = '0000' then
    return false;
  end if;
  begin
    parsed := value::date;
  exception when others then
    return false;
  end;
  return to_char(parsed, 'YYYY-MM-DD') = value;
end;
$$;

alter table public.guardians drop constraint guardians_phone_format_check;
alter table public.guardians
  add constraint guardians_phone_format_check
  check (phone is null or public.is_valid_registration_phone(phone)) not valid;
alter table public.guardians validate constraint guardians_phone_format_check;

create function public.assert_strict_registration_response_values()
returns trigger language plpgsql set search_path = '' as $$
declare schema_record jsonb; field jsonb; answer jsonb; answer_text text;
begin
  select version.schema into schema_record
  from public.registration_form_versions as version
  where version.organization_id = new.organization_id
    and version.tryout_id = new.tryout_id
    and version.id = new.registration_form_version_id;

  if schema_record is null or jsonb_typeof(new.responses) <> 'object'
    or octet_length(new.responses::text) > 32768 then
    raise exception 'invalid registration responses' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_object_keys(new.responses) as response_key
    where not exists (
      select 1 from jsonb_array_elements(schema_record -> 'fields') as item
      where item.value ->> 'key' = response_key
    )
  ) then
    raise exception 'unknown registration response' using errcode = '22023';
  end if;

  for field in select value from jsonb_array_elements(schema_record -> 'fields') loop
    answer := new.responses -> (field ->> 'key');
    if (field ->> 'required')::boolean and (
      answer is null or answer = 'null'::jsonb
      or (jsonb_typeof(answer) = 'string' and trim(answer #>> '{}') = '')
    ) then
      raise exception 'required registration response missing' using errcode = '22023';
    end if;
    if answer is null or answer = 'null'::jsonb then continue; end if;

    if field ->> 'kind' in ('checkbox', 'consent') then
      if jsonb_typeof(answer) <> 'boolean'
        or (field ->> 'kind' = 'consent' and (field ->> 'required')::boolean and answer <> 'true'::jsonb) then
        raise exception 'invalid registration response' using errcode = '22023';
      end if;
      continue;
    end if;
    if jsonb_typeof(answer) <> 'string' then
      raise exception 'invalid registration response' using errcode = '22023';
    end if;
    answer_text := answer #>> '{}';
    case field ->> 'kind'
      when 'text' then
        if char_length(trim(answer_text)) > 500 then raise exception 'invalid registration response' using errcode = '22023'; end if;
      when 'textarea' then
        if char_length(trim(answer_text)) > 5000 then raise exception 'invalid registration response' using errcode = '22023'; end if;
      when 'email' then
        if not public.is_valid_registration_email(answer_text) then raise exception 'invalid registration response' using errcode = '22023'; end if;
      when 'phone' then
        if not public.is_valid_registration_phone(answer_text) then raise exception 'invalid registration response' using errcode = '22023'; end if;
      when 'date' then
        if not public.is_valid_registration_calendar_date(answer_text) then raise exception 'invalid registration response' using errcode = '22023'; end if;
      when 'select' then
        if not ((field -> 'options') ? answer_text) then raise exception 'invalid registration response' using errcode = '22023'; end if;
      else
        raise exception 'invalid registration response kind' using errcode = '22023';
    end case;
  end loop;
  return new;
end;
$$;
create trigger assert_strict_registration_response_values
before insert or update of responses, registration_form_version_id on public.tryout_registrations
for each row execute function public.assert_strict_registration_response_values();

create or replace function public.submit_public_registration(p_tryout_slug text, p_submission jsonb, p_idempotency_key text, p_rate_key_hash text)
returns table(outcome text, registration_id uuid, confirmation_token text)
language plpgsql security definer set search_path = '' as $$
declare target public.tryouts%rowtype; version public.registration_form_versions%rowtype; selected_division uuid; athlete uuid; guardian uuid; registration uuid; raw_token text; field jsonb; answer jsonb; answer_text text; v_given_name text; v_family_name text; v_guardian_name text; v_guardian_email text; v_guardian_phone text; v_birth_date date; valid_key text; payload_digest text; attempts_after integer;
begin
  if p_tryout_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' or p_idempotency_key !~ '^[A-Za-z0-9_-]{24,200}$' or p_rate_key_hash !~ '^[0-9a-f]{64}$' or jsonb_typeof(p_submission) <> 'object' then raise exception 'invalid public registration request' using errcode = '22023'; end if;
  if exists(select 1 from jsonb_object_keys(p_submission) key where key not in ('givenName','familyName','birthDate','guardianName','guardianEmail','guardianPhone','divisionId','responses')) then raise exception 'unknown registration field' using errcode = '22023'; end if;
  select * into target from public.tryouts where slug = p_tryout_slug and status = 'published' and registration_starts_at <= clock_timestamp() and registration_ends_at > clock_timestamp() for update;
  if not found then return query select 'registration_closed'::text, null::uuid, null::text; return; end if;
  perform pg_advisory_xact_lock(hashtextextended(target.id::text || ':' || p_idempotency_key, 0));
  valid_key := encode(extensions.digest(p_idempotency_key, 'sha256'), 'hex');
  payload_digest := encode(extensions.digest(p_submission::text, 'sha256'), 'hex');
  select id into registration from public.tryout_registrations where organization_id = target.organization_id and tryout_id = target.id and submission_key_digest = valid_key and submission_digest = payload_digest;
  if found then return query select 'replayed'::text, registration, null::text; return; end if;
  if exists(select 1 from public.tryout_registrations where organization_id = target.organization_id and tryout_id = target.id and submission_key_digest = valid_key) then return query select 'idempotency_conflict'::text, null::uuid, null::text; return; end if;
  with expired as (select key_hash from public.registration_rate_counters where expires_at <= clock_timestamp() order by expires_at limit 100) delete from public.registration_rate_counters where key_hash in (select key_hash from expired);
  insert into public.registration_rate_counters(key_hash, attempts, window_started_at, expires_at) values(p_rate_key_hash, 1, clock_timestamp(), clock_timestamp() + interval '10 minutes') on conflict(key_hash) do update set attempts = case when public.registration_rate_counters.expires_at <= clock_timestamp() then 1 else public.registration_rate_counters.attempts + 1 end, window_started_at = case when public.registration_rate_counters.expires_at <= clock_timestamp() then clock_timestamp() else public.registration_rate_counters.window_started_at end, expires_at = case when public.registration_rate_counters.expires_at <= clock_timestamp() then clock_timestamp() + interval '10 minutes' else public.registration_rate_counters.expires_at end returning attempts into attempts_after;
  if attempts_after > 10 then return query select 'rate_limited'::text, null::uuid, null::text; return; end if;
  select v.* into version from public.tryout_registration_form_selections s join public.registration_form_versions v on v.organization_id = s.organization_id and v.tryout_id = s.tryout_id and v.id = s.registration_form_version_id where s.organization_id = target.organization_id and s.tryout_id = target.id and v.status = 'published' for update of s, v;
  if not found then return query select 'registration_closed'::text, null::uuid, null::text; return; end if;
  v_given_name := trim(coalesce(p_submission ->> 'givenName', ''));
  v_family_name := trim(coalesce(p_submission ->> 'familyName', ''));
  v_guardian_name := trim(coalesce(p_submission ->> 'guardianName', ''));
  v_guardian_email := public.normalize_registration_text(coalesce(p_submission ->> 'guardianEmail', ''));
  v_guardian_phone := trim(coalesce(p_submission ->> 'guardianPhone', ''));
  if not public.is_valid_registration_calendar_date(p_submission ->> 'birthDate') then raise exception 'invalid birth date' using errcode = '22023'; end if;
  v_birth_date := (p_submission ->> 'birthDate')::date;
  if char_length(v_given_name) not between 1 and 120 or char_length(v_family_name) not between 1 and 120 or char_length(v_guardian_name) not between 1 and 160 or not public.is_valid_registration_email(v_guardian_email) or (v_guardian_phone <> '' and not public.is_valid_registration_phone(v_guardian_phone)) or v_birth_date > current_date then raise exception 'invalid identity' using errcode = '22023'; end if;
  if jsonb_typeof(p_submission -> 'responses') <> 'object' or octet_length((p_submission -> 'responses')::text) > 32768 then raise exception 'invalid responses' using errcode = '22023'; end if;
  if exists(select 1 from jsonb_object_keys(p_submission -> 'responses') k where not exists(select 1 from jsonb_array_elements(version.schema -> 'fields') f where f ->> 'key' = k)) then raise exception 'unknown registration response' using errcode = '22023'; end if;
  for field in select value from jsonb_array_elements(version.schema -> 'fields') loop
    answer := p_submission -> 'responses' -> (field ->> 'key');
    if (field ->> 'required')::boolean and (answer is null or answer = 'null'::jsonb or (jsonb_typeof(answer) = 'string' and trim(answer #>> '{}') = '')) then raise exception 'required response missing' using errcode = '22023'; end if;
    if answer is null or answer = 'null'::jsonb then continue; end if;
    if field ->> 'kind' in ('checkbox','consent') then
      if jsonb_typeof(answer) <> 'boolean' or (field ->> 'kind' = 'consent' and (field ->> 'required')::boolean and answer <> 'true'::jsonb) then raise exception 'invalid response' using errcode = '22023'; end if;
      continue;
    end if;
    if jsonb_typeof(answer) <> 'string' then raise exception 'invalid response' using errcode = '22023'; end if;
    answer_text := answer #>> '{}';
    case field ->> 'kind'
      when 'text' then if char_length(trim(answer_text)) > 500 then raise exception 'invalid response' using errcode = '22023'; end if;
      when 'textarea' then if char_length(trim(answer_text)) > 5000 then raise exception 'invalid response' using errcode = '22023'; end if;
      when 'email' then if not public.is_valid_registration_email(answer_text) then raise exception 'invalid response' using errcode = '22023'; end if;
      when 'phone' then if not public.is_valid_registration_phone(answer_text) then raise exception 'invalid response' using errcode = '22023'; end if;
      when 'date' then if not public.is_valid_registration_calendar_date(answer_text) then raise exception 'invalid response' using errcode = '22023'; end if;
      when 'select' then if not ((field -> 'options') ? answer_text) then raise exception 'invalid response' using errcode = '22023'; end if;
      else raise exception 'invalid response kind' using errcode = '22023';
    end case;
  end loop;
  selected_division := nullif(p_submission ->> 'divisionId', '')::uuid;
  if selected_division is null then select id into selected_division from public.tryout_divisions where organization_id = target.organization_id and tryout_id = target.id order by sort_order limit 1; end if;
  if not exists(select 1 from public.tryout_divisions where organization_id = target.organization_id and tryout_id = target.id and id = selected_division) then raise exception 'invalid division' using errcode = '22023'; end if;
  insert into public.athletes(organization_id, given_name, family_name, normalized_given_name, normalized_family_name, birth_date) values(target.organization_id, v_given_name, v_family_name, public.normalize_registration_text(v_given_name), public.normalize_registration_text(v_family_name), v_birth_date) returning id into athlete;
  insert into public.guardians(organization_id, name, email, normalized_email) values(target.organization_id, v_guardian_name, v_guardian_email, v_guardian_email) returning id into guardian;
  insert into public.athlete_guardians(organization_id, athlete_id, guardian_id) values(target.organization_id, athlete, guardian);
  insert into public.tryout_registrations(organization_id, tryout_id, athlete_id, division_id, registration_form_version_id, responses, submission_key_digest, submission_digest) values(target.organization_id, target.id, athlete, selected_division, version.id, p_submission -> 'responses', valid_key, payload_digest) returning id into registration;
  insert into public.session_enrollments(organization_id, tryout_id, registration_id, session_id) select target.organization_id, target.id, registration, s.id from public.tryout_sessions s where s.organization_id = target.organization_id and s.tryout_id = target.id and s.division_id = selected_division;
  insert into public.registration_duplicate_candidates(organization_id, registration_id, candidate_athlete_id, reason) select target.organization_id, registration, c.id, 'name_birthdate_guardian_email' from public.athletes c join public.athlete_guardians l on l.organization_id = c.organization_id and l.athlete_id = c.id join public.guardians g on g.organization_id = l.organization_id and g.id = l.guardian_id where c.organization_id = target.organization_id and c.id <> athlete and c.normalized_given_name = public.normalize_registration_text(v_given_name) and c.normalized_family_name = public.normalize_registration_text(v_family_name) and c.birth_date = v_birth_date and g.normalized_email = v_guardian_email;
  raw_token := encode(extensions.gen_random_bytes(32), 'hex');
  update public.registration_confirmation_tokens as confirmation set revoked_at = clock_timestamp() where confirmation.organization_id = target.organization_id and confirmation.registration_id = registration and confirmation.purpose = 'registration_confirmation' and confirmation.used_at is null and confirmation.revoked_at is null;
  insert into public.registration_confirmation_tokens(organization_id, registration_id, token_digest, expires_at) values(target.organization_id, registration, encode(extensions.digest(raw_token, 'sha256'), 'hex'), clock_timestamp() + interval '7 days');
  return query select 'submitted'::text, registration, raw_token;
end;
$$;

-- Rotate under the registration row lock. Only a digest is persisted; the raw
-- value exists only in this service transaction and its single response.
create function public.rotate_registration_confirmation_token(p_registration_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare target public.tryout_registrations%rowtype; raw_token text;
begin
  select * into target from public.tryout_registrations where id = p_registration_id for update;
  if not found then return null; end if;
  update public.registration_confirmation_tokens
    set revoked_at = clock_timestamp()
    where organization_id = target.organization_id and registration_id = target.id
      and purpose = 'registration_confirmation' and used_at is null and revoked_at is null;
  raw_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.registration_confirmation_tokens(organization_id, registration_id, token_digest, expires_at)
  values(target.organization_id, target.id, encode(extensions.digest(raw_token, 'sha256'), 'hex'), clock_timestamp() + interval '7 days');
  return raw_token;
end;
$$;
revoke all on function public.rotate_registration_confirmation_token(uuid) from public, anon, authenticated;

create or replace function public.submit_public_registration_with_phone(
  p_tryout_slug text, p_submission jsonb, p_idempotency_key text, p_rate_key_hash text
) returns table(outcome text, registration_id uuid, confirmation_token text)
language plpgsql security definer set search_path = '' as $$
declare result_row record; v_phone text;
begin
  v_phone := nullif(regexp_replace(trim(coalesce(p_submission ->> 'guardianPhone', '')), '\\s+', ' ', 'g'), '');
  if v_phone is not null and not public.is_valid_registration_phone(v_phone) then
    raise exception 'invalid guardian phone' using errcode = '22023';
  end if;
  select * into result_row from public.submit_public_registration(p_tryout_slug, p_submission, p_idempotency_key, p_rate_key_hash);
  if result_row.outcome = 'submitted' and v_phone is not null then
    update public.guardians as guardian set phone = v_phone
    from public.tryout_registrations as registration
    join public.athlete_guardians as link
      on link.organization_id = registration.organization_id and link.athlete_id = registration.athlete_id
    where registration.id = result_row.registration_id
      and guardian.organization_id = link.organization_id and guardian.id = link.guardian_id and guardian.phone is null;
  elsif result_row.outcome = 'replayed' then
    result_row.confirmation_token := public.rotate_registration_confirmation_token(result_row.registration_id);
  end if;
  return query select result_row.outcome, result_row.registration_id, result_row.confirmation_token;
end;
$$;
revoke all on function public.submit_public_registration_with_phone(text, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.submit_public_registration_with_phone(text, jsonb, text, text) to service_role;

create or replace function public.consume_registration_confirmation_token(p_token text)
returns table(outcome text, registration_id uuid)
language plpgsql security definer set search_path = '' as $$
declare digest text; target_registration_id uuid; token_row public.registration_confirmation_tokens%rowtype;
begin
  if p_token !~ '^[0-9a-f]{64}$' then return query select 'invalid'::text, null::uuid; return; end if;
  digest := encode(extensions.digest(p_token, 'sha256'), 'hex');
  select token.registration_id into target_registration_id
    from public.registration_confirmation_tokens as token where token.token_digest = digest;
  if not found then return query select 'invalid'::text, null::uuid; return; end if;
  perform 1 from public.tryout_registrations where id = target_registration_id for update;
  select * into token_row from public.registration_confirmation_tokens where token_digest = digest;
  if token_row.revoked_at is not null then return query select 'invalid'::text, null::uuid; return; end if;
  if token_row.used_at is not null then return query select 'already_confirmed'::text, token_row.registration_id; return; end if;
  if token_row.expires_at <= clock_timestamp() then return query select 'expired'::text, token_row.registration_id; return; end if;
  update public.registration_confirmation_tokens set used_at = clock_timestamp() where id = token_row.id;
  return query select 'confirmed'::text, token_row.registration_id;
end;
$$;

create function public.reissue_registration_confirmation_token(p_token text, p_guardian_email text)
returns table(outcome text, confirmation_token text)
language plpgsql security definer set search_path = '' as $$
declare digest text; target_registration_id uuid; token_row public.registration_confirmation_tokens%rowtype; raw_token text;
begin
  if p_token !~ '^[0-9a-f]{64}$' or not public.is_valid_registration_email(p_guardian_email) then
    return query select 'invalid'::text, null::text; return;
  end if;
  digest := encode(extensions.digest(p_token, 'sha256'), 'hex');
  select token.registration_id into target_registration_id
  from public.registration_confirmation_tokens as token
  join public.tryout_registrations as registration on registration.organization_id = token.organization_id and registration.id = token.registration_id
  join public.athlete_guardians as link on link.organization_id = registration.organization_id and link.athlete_id = registration.athlete_id and link.is_primary_contact
  join public.guardians as guardian on guardian.organization_id = link.organization_id and guardian.id = link.guardian_id
  where token.token_digest = digest
    and guardian.normalized_email = public.normalize_registration_text(p_guardian_email);
  if not found then return query select 'invalid'::text, null::text; return; end if;
  perform 1 from public.tryout_registrations where id = target_registration_id for update;
  select * into token_row from public.registration_confirmation_tokens where token_digest = digest;
  if token_row.revoked_at is not null then return query select 'invalid'::text, null::text; return; end if;
  if token_row.used_at is not null then return query select 'already_confirmed'::text, null::text; return; end if;
  raw_token := public.rotate_registration_confirmation_token(target_registration_id);
  return query select 'reissued'::text, raw_token;
end;
$$;

create function public.consume_public_registration_rate_limit(p_rate_key_hash text, p_limit integer)
returns table(outcome text, retry_after_seconds integer)
language plpgsql security definer set search_path = '' as $$
declare attempts_after integer; target_expiry timestamptz;
begin
  if p_rate_key_hash !~ '^[0-9a-f]{64}$' or p_limit not between 1 and 10 then
    raise exception 'invalid public rate bucket' using errcode = '22023';
  end if;
  with expired as (
    select key_hash from public.registration_rate_counters
    where expires_at <= clock_timestamp() order by expires_at limit 100
  ) delete from public.registration_rate_counters where key_hash in (select key_hash from expired);
  insert into public.registration_rate_counters(key_hash, attempts, window_started_at, expires_at)
  values(p_rate_key_hash, 1, clock_timestamp(), clock_timestamp() + interval '10 minutes')
  on conflict(key_hash) do update set
    attempts = case when public.registration_rate_counters.expires_at <= clock_timestamp() then 1 else public.registration_rate_counters.attempts + 1 end,
    window_started_at = case when public.registration_rate_counters.expires_at <= clock_timestamp() then clock_timestamp() else public.registration_rate_counters.window_started_at end,
    expires_at = case when public.registration_rate_counters.expires_at <= clock_timestamp() then clock_timestamp() + interval '10 minutes' else public.registration_rate_counters.expires_at end
  returning attempts, expires_at into attempts_after, target_expiry;
  if attempts_after > p_limit then
    return query select 'rate_limited'::text, greatest(1, ceil(extract(epoch from target_expiry - clock_timestamp()))::integer);
  else
    return query select 'allowed'::text, 0;
  end if;
end;
$$;

revoke all on function public.consume_registration_confirmation_token(text),
  public.reissue_registration_confirmation_token(text, text),
  public.consume_public_registration_rate_limit(text, integer)
from public, anon, authenticated;
grant execute on function public.consume_registration_confirmation_token(text),
  public.reissue_registration_confirmation_token(text, text),
  public.consume_public_registration_rate_limit(text, integer)
to service_role;
