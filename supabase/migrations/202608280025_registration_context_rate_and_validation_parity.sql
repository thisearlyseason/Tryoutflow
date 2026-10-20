-- Registration accepts one explicit, locale-independent whitespace set in
-- both TypeScript and PostgreSQL: TAB-CR, SPACE, NEL, NBSP, OGHAM SPACE,
-- U+2000-U+200A, LINE/PARAGRAPH SEPARATOR, NARROW NBSP, MEDIUM MATHEMATICAL
-- SPACE, IDEOGRAPHIC SPACE, and BOM/ZWNBSP. All are collapsed to one ASCII
-- space and leading/trailing spaces are removed before validation.
create function public.registration_whitespace_characters()
returns text language sql immutable parallel safe set search_path = '' as $$
  select chr(9) || chr(10) || chr(11) || chr(12) || chr(13) || chr(32)
    || chr(133) || chr(160) || chr(5760)
    || chr(8192) || chr(8193) || chr(8194) || chr(8195) || chr(8196)
    || chr(8197) || chr(8198) || chr(8199) || chr(8200) || chr(8201) || chr(8202)
    || chr(8232) || chr(8233) || chr(8239) || chr(8287) || chr(12288) || chr(65279);
$$;

create function public.canonical_registration_text(value text)
returns text language sql immutable parallel safe strict set search_path = '' as $$
  select btrim(
    regexp_replace(
      translate(
        value,
        public.registration_whitespace_characters(),
        repeat(' ', char_length(public.registration_whitespace_characters()))
      ),
      ' +',
      ' ',
      'g'
    ),
    ' '
  );
$$;

create or replace function public.normalize_registration_text(value text)
returns text language sql immutable parallel safe strict set search_path = '' as $$
  select lower(public.canonical_registration_text(value));
$$;

create or replace function public.is_valid_registration_email(value text)
returns boolean language sql immutable parallel safe set search_path = '' as $$
  select value is not null
    and char_length(public.canonical_registration_text(value)) between 3 and 254
    and public.canonical_registration_text(value) ~ '^[^ @]+@[^ @]+[.][^ @]+$';
$$;

create or replace function public.is_valid_registration_phone(value text)
returns boolean language sql immutable parallel safe set search_path = '' as $$
  select value is not null
    and char_length(public.canonical_registration_text(value)) between 7 and 32
    and public.canonical_registration_text(value) ~ '^[+]?[0-9 ()-]+$'
    and char_length(regexp_replace(public.canonical_registration_text(value), '[^0-9]', '', 'g')) between 7 and 15;
$$;

create or replace function public.is_valid_registration_calendar_date(value text)
returns boolean language plpgsql immutable parallel safe set search_path = '' as $$
declare parsed date;
begin
  if value is null or value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    or left(value, 4) = '0000' then
    return false;
  end if;
  begin
    parsed := value::date;
  exception when others then
    return false;
  end;
  return extract(year from parsed) between 1 and 9999 and to_char(parsed, 'YYYY-MM-DD') = value;
end;
$$;

alter table public.athletes drop constraint athletes_given_name_check;
alter table public.athletes drop constraint athletes_family_name_check;
alter table public.athletes
  add constraint athletes_given_name_check
    check (char_length(public.canonical_registration_text(given_name)) between 1 and 120) not valid,
  add constraint athletes_family_name_check
    check (char_length(public.canonical_registration_text(family_name)) between 1 and 120) not valid;
alter table public.athletes validate constraint athletes_given_name_check;
alter table public.athletes validate constraint athletes_family_name_check;

alter table public.guardians drop constraint guardians_name_check;
alter table public.guardians drop constraint guardians_email_check;
alter table public.guardians
  add constraint guardians_name_check
    check (char_length(public.canonical_registration_text(name)) between 1 and 160) not valid,
  add constraint guardians_email_check
    check (public.is_valid_registration_email(normalized_email)) not valid;
alter table public.guardians validate constraint guardians_name_check;
alter table public.guardians validate constraint guardians_email_check;

create or replace function public.assert_strict_registration_response_values()
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
      or (jsonb_typeof(answer) = 'string' and public.canonical_registration_text(answer #>> '{}') = '')
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
        if char_length(public.canonical_registration_text(answer_text)) > 500 then raise exception 'invalid registration response' using errcode = '22023'; end if;
      when 'textarea' then
        if char_length(public.canonical_registration_text(answer_text)) > 5000 then raise exception 'invalid registration response' using errcode = '22023'; end if;
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

-- Normalize exactly the fields whose TypeScript validators normalize before
-- entering the internal registration transaction. Date and select values stay
-- exact; checkbox and consent values stay booleans.
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
  if jsonb_typeof(normalized_submission) = 'object' then
    if jsonb_typeof(normalized_submission -> 'givenName') = 'string' then
      normalized_submission := jsonb_set(normalized_submission, '{givenName}', to_jsonb(public.canonical_registration_text(normalized_submission ->> 'givenName')));
    end if;
    if jsonb_typeof(normalized_submission -> 'familyName') = 'string' then
      normalized_submission := jsonb_set(normalized_submission, '{familyName}', to_jsonb(public.canonical_registration_text(normalized_submission ->> 'familyName')));
    end if;
    if jsonb_typeof(normalized_submission -> 'guardianName') = 'string' then
      normalized_submission := jsonb_set(normalized_submission, '{guardianName}', to_jsonb(public.canonical_registration_text(normalized_submission ->> 'guardianName')));
    end if;
    if jsonb_typeof(normalized_submission -> 'guardianEmail') = 'string' then
      normalized_submission := jsonb_set(normalized_submission, '{guardianEmail}', to_jsonb(public.canonical_registration_text(normalized_submission ->> 'guardianEmail')));
    end if;
    if jsonb_typeof(normalized_submission -> 'guardianPhone') = 'string' then
      normalized_submission := jsonb_set(normalized_submission, '{guardianPhone}', to_jsonb(public.canonical_registration_text(normalized_submission ->> 'guardianPhone')));
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
  end if;

  v_phone := nullif(normalized_submission ->> 'guardianPhone', '');
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

-- Only the normalizing wrapper is externally callable by the server. The base
-- transaction and token rotator are internal implementation details.
revoke all on function public.submit_public_registration(text, jsonb, text, text),
  public.rotate_registration_confirmation_token(uuid)
from public, anon, authenticated, service_role;
revoke all on function public.submit_public_registration_with_phone(text, jsonb, text, text),
  public.consume_registration_confirmation_token(text),
  public.reissue_registration_confirmation_token(text, text),
  public.consume_public_registration_rate_limit(text, integer)
from public, anon, authenticated;
grant execute on function public.submit_public_registration_with_phone(text, jsonb, text, text),
  public.consume_registration_confirmation_token(text),
  public.reissue_registration_confirmation_token(text, text),
  public.consume_public_registration_rate_limit(text, integer)
to service_role;
