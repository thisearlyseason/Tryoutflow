-- Configurable registration questions retain immutable accepted form snapshots.

-- Waiver terms belong to the immutable form schema; acceptance remains boolean.
create or replace function public.assert_valid_registration_form_schema()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  field jsonb;
begin
  if jsonb_typeof(new.schema) <> 'object'
    or new.schema - array['fields','builtInFields'] <> '{}'::jsonb
    or jsonb_typeof(new.schema -> 'fields') <> 'array'
    or jsonb_array_length(new.schema -> 'fields') > 100
  then
    raise exception 'registration form schema requires a fields array' using errcode = '23514';
  end if;

  for field in select value from jsonb_array_elements(new.schema -> 'fields') loop
    if jsonb_typeof(field) <> 'object'
      or field - array['key', 'label', 'kind', 'required', 'sortOrder', 'helpText', 'options', 'waiverText', 'enabled'] <> '{}'::jsonb
      or (field ? 'enabled' and jsonb_typeof(field->'enabled') is distinct from 'boolean')
      or jsonb_typeof(field -> 'key') <> 'string'
      or field ->> 'key' !~ '^[a-z][a-z0-9_]{0,62}$'
      or jsonb_typeof(field -> 'label') <> 'string'
      or char_length(trim(field ->> 'label')) not between 1 and 120
      or jsonb_typeof(field -> 'kind') <> 'string'
      or field ->> 'kind' not in ('text', 'email', 'phone', 'date', 'select', 'checkbox', 'textarea', 'consent')
      or jsonb_typeof(field -> 'required') <> 'boolean'
      or jsonb_typeof(field -> 'sortOrder') <> 'number'
      or field ->> 'sortOrder' !~ '^(0|[1-9][0-9]*)$'
      or (field ? 'helpText' and (jsonb_typeof(field -> 'helpText') <> 'string' or char_length(trim(field ->> 'helpText')) > 500))
    then
      raise exception 'registration form schema contains an invalid field' using errcode = '23514';
    end if;

    if field ? 'waiverText' and (
      field ->> 'kind' is distinct from 'consent'
      or jsonb_typeof(field -> 'waiverText') is distinct from 'string'
      or char_length(regexp_replace(field ->> 'waiverText',
        '^[[:space:]]+|[[:space:]]+$', '', 'g')) not between 1 and 20000
    ) then
      raise exception 'registration form waiver text is invalid' using errcode = '23514';
    end if;

    if (field ->> 'kind' = 'select' and (
      jsonb_typeof(field -> 'options') <> 'array'
      or jsonb_array_length(field -> 'options') = 0
      or jsonb_array_length(field -> 'options') > 100
      or exists (
        select 1 from jsonb_array_elements(field -> 'options') as option
        where jsonb_typeof(option.value) <> 'string'
          or char_length(trim(option.value #>> '{}')) not between 1 and 120
      )
    ))
      or (field ->> 'kind' <> 'select' and field ? 'options') then
      raise exception 'registration form select options are invalid' using errcode = '23514';
    end if;
  end loop;

  if exists (
    select 1 from jsonb_array_elements(new.schema -> 'fields') as item
    group by item.value ->> 'key'
    having count(*) > 1
  ) or exists (
    select 1 from jsonb_array_elements(new.schema -> 'fields') as item
    group by item.value ->> 'sortOrder'
    having count(*) > 1
  ) then
    raise exception 'registration form fields require unique keys and ordering' using errcode = '23514';
  end if;

  if new.schema ? 'builtInFields' then
    if exists(select 1 from jsonb_array_elements(new.schema->'fields') item
      where item->>'key' in ('custom_birth_date','custom_guardian_name','custom_guardian_email','custom_guardian_phone'))
    then raise check_violation using message='configured registration fields cannot use legacy builtin aliases'; end if;
    if jsonb_typeof(new.schema->'builtInFields') is distinct from 'array'
      or jsonb_array_length(new.schema->'builtInFields')>8 then
      raise check_violation using message='invalid builtin registration fields';
    end if;
    for field in select value from jsonb_array_elements(new.schema->'builtInFields') loop
      if jsonb_typeof(field) is distinct from 'object'
        or field-array['key','label','enabled','required','sortOrder']<>'{}'::jsonb
        or not (field ?& array['key','label','enabled','required','sortOrder'])
        or jsonb_typeof(field->'key') is distinct from 'string'
        or field->>'key' not in ('givenName','familyName','birthDate','guardianName','guardianEmail','guardianPhone','divisionId','positionId')
        or jsonb_typeof(field->'label') is distinct from 'string'
        or char_length(btrim(field->>'label')) not between 1 and 120
        or jsonb_typeof(field->'enabled') is distinct from 'boolean'
        or jsonb_typeof(field->'required') is distinct from 'boolean'
        or jsonb_typeof(field->'sortOrder') is distinct from 'number'
        or field->>'sortOrder' !~ '^(0|[1-9][0-9]*)$'
      then raise check_violation using message='invalid builtin registration field'; end if;
    end loop;
    if exists(select 1 from unnest(array['givenName','familyName','guardianEmail']) required_key
      where not exists(select 1 from jsonb_array_elements(new.schema->'builtInFields') item
        where item->>'key'=required_key and item->'enabled'='true'::jsonb and item->'required'='true'::jsonb))
      or exists(select 1 from jsonb_array_elements(new.schema->'builtInFields') item group by item->>'key' having count(*)>1)
      or exists(select 1 from jsonb_array_elements((new.schema->'builtInFields')||(new.schema->'fields')) item
        group by (item->>'sortOrder')::numeric having count(*)>1)
    then raise check_violation using message='builtin registration fields require core identity and unique ordering'; end if;
  end if;
  return new;
end;
$$;


alter table public.athletes alter column birth_date drop not null;
alter table public.guardians alter column name drop not null;
-- Keep the existing JSON hash for dated identities and hash JSON null for undated ones.
alter function public.canonical_athlete_identity_lock_key(uuid,text,text,date) called on null input;

create or replace function private.registration_builtin_field(p_schema jsonb,p_key text)
returns jsonb language sql immutable set search_path='' as $$
  select case when p_schema ? 'builtInFields' then
    coalesce((select item from jsonb_array_elements(p_schema->'builtInFields') item where item->>'key'=p_key),
      jsonb_build_object('key',p_key,'enabled',false,'required',false))
  else jsonb_build_object('key',p_key,'enabled',true,
    'required',p_key in ('givenName','familyName','birthDate','guardianName','guardianEmail')) end
$$;
revoke all on function private.registration_builtin_field(jsonb,text) from public,anon,authenticated,service_role;

create or replace function private.normalize_registration_responses(
  p_schema jsonb,
  p_responses jsonb
) returns jsonb
language plpgsql immutable set search_path=''
as $$
declare
  normalized jsonb:=p_responses;
  field jsonb;
  current_field_key text;
  field_kind text;
  answer jsonb;
  answer_text text;
begin
  if jsonb_typeof(p_schema)<>'object'
    or jsonb_typeof(p_schema->'fields')<>'array'
    or jsonb_array_length(p_schema->'fields')>100
    or jsonb_typeof(p_responses)<>'object'
    or octet_length(p_responses::text)>32768
  then
    raise invalid_parameter_value using message='invalid registration responses';
  end if;
  if exists(
    select 1 from jsonb_array_elements(p_schema->'fields') item
    where jsonb_typeof(item)<>'object'
      or coalesce(item->>'key','')!~'^[a-z][a-z0-9_]{0,62}$'
  ) or exists(
    select candidate.field_key
    from (
      select item->>'key' as field_key
      from jsonb_array_elements(p_schema->'fields') item
    ) candidate
    group by candidate.field_key having count(*)<>1
  ) then
    raise invalid_parameter_value using message='invalid registration form fields';
  end if;
  if exists(
    select 1 from jsonb_object_keys(p_responses) response_key
    where not exists(
      select 1 from jsonb_array_elements(p_schema->'fields') item
      where item->>'key'=response_key
    )
  ) then
    raise invalid_parameter_value using message='unknown registration response';
  end if;

  for field in select value from jsonb_array_elements(p_schema->'fields') loop
    current_field_key:=field->>'key';
    field_kind:=field->>'kind';
    answer:=p_responses->current_field_key;
    if field_kind not in('text','email','phone','date','select','checkbox','textarea','consent')
      or jsonb_typeof(field->'required')<>'boolean'
    then
      raise invalid_parameter_value using message='invalid registration response kind';
    end if;
    if field_kind='select' and (
      jsonb_typeof(field->'options')<>'array'
      or jsonb_array_length(field->'options') not between 1 and 100
      or exists(
        select option_text from jsonb_array_elements_text(field->'options') option_text
        group by option_text having count(*)<>1
      )
    ) then
      raise invalid_parameter_value using message='invalid registration select options';
    end if;
    if field->'enabled'='false'::jsonb then
      if answer is not null and answer<>'null'::jsonb
        and not (jsonb_typeof(answer)='string' and public.canonical_registration_text(answer#>>'{}')='')
      then raise invalid_parameter_value using message='hidden registration response supplied'; end if;
      normalized:=normalized-current_field_key;
      continue;
    end if;
    if (field->>'required')::boolean and (
      answer is null
      or answer='null'::jsonb
      or (
        jsonb_typeof(answer)='string'
        and public.canonical_registration_text(answer#>>'{}')=''
      )
    ) then
      raise invalid_parameter_value using message='required registration response missing';
    end if;
    if answer is null or answer='null'::jsonb then continue; end if;

    if field_kind in('checkbox','consent') then
      if jsonb_typeof(answer)<>'boolean'
        or (
          field_kind='consent'
          and (field->>'required')::boolean
          and answer<>'true'::jsonb
        )
      then
        raise invalid_parameter_value using message='invalid registration response';
      end if;
      continue;
    end if;
    if jsonb_typeof(answer)<>'string' then
      raise invalid_parameter_value using message='invalid registration response';
    end if;
    answer_text:=answer#>>'{}';
    if field_kind in('text','textarea','email','phone') then
      answer_text:=public.canonical_registration_text(answer_text);
      normalized:=jsonb_set(normalized,array[current_field_key],to_jsonb(answer_text));
    end if;
    case field_kind
      when 'text' then
        if char_length(answer_text)>500 then
          raise invalid_parameter_value using message='invalid registration response';
        end if;
      when 'textarea' then
        if char_length(answer_text)>5000 then
          raise invalid_parameter_value using message='invalid registration response';
        end if;
      when 'email' then
        if not public.is_valid_registration_email(answer_text) then
          raise invalid_parameter_value using message='invalid registration response';
        end if;
      when 'phone' then
        if not public.is_valid_registration_phone(answer_text) then
          raise invalid_parameter_value using message='invalid registration response';
        end if;
      when 'date' then
        if not public.is_valid_registration_calendar_date(answer_text) then
          raise invalid_parameter_value using message='invalid registration response';
        end if;
      when 'select' then
        if not ((field->'options')?answer_text) then
          raise invalid_parameter_value using message='invalid registration response';
        end if;
      else
        raise invalid_parameter_value using message='invalid registration response kind';
    end case;
  end loop;
  return normalized;
end;
$$;


create or replace function public.registration_has_missing_information(p_registration_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(
    select 1
    from public.tryout_registrations r
    join public.registration_form_versions v
      on v.organization_id=r.organization_id and v.tryout_id=r.tryout_id and v.id=r.registration_form_version_id
    cross join lateral jsonb_array_elements(v.schema->'fields') f
    where r.id=p_registration_id and coalesce((f->>'enabled')::boolean,true) and (f->>'required')::boolean
      and (
        not (r.responses ? (f->>'key'))
        or r.responses->(f->>'key') in ('null'::jsonb,'""'::jsonb)
        or (f->>'kind'='consent' and r.responses->(f->>'key')<>'true'::jsonb)
      )
  );
$$;
create or replace function private.normalize_public_registration_submission(
  p_tryout_slug text,
  p_submission jsonb,
  p_schema jsonb
) returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  normalized_submission jsonb:=p_submission;
  schema_record jsonb:=p_schema;
  builtin jsonb;
  builtin_key text;
  builtin_value text;
  configured boolean:=coalesce(p_schema ? 'builtInFields',false);
  field jsonb;
  field_key text;
  field_kind text;
  answer jsonb;
  answer_text text;
  raw_position text;
  raw_division text;
begin
  if jsonb_typeof(normalized_submission) is distinct from 'object'
    or jsonb_typeof(normalized_submission->'responses') is distinct from 'object'
  then raise invalid_parameter_value using message='invalid registration identity/contact types'; end if;
  foreach builtin_key in array array['givenName','familyName','birthDate','guardianName','guardianEmail','guardianPhone','divisionId','positionId'] loop
    builtin:=private.registration_builtin_field(schema_record,builtin_key);
    if not configured then
      -- Preserve the shipped legacy request shape, including position null and optional UUID semantics.
      if builtin_key in ('givenName','familyName','birthDate','guardianName','guardianEmail')
        and jsonb_typeof(normalized_submission->builtin_key) is distinct from 'string'
      then raise invalid_parameter_value using message='invalid registration identity/contact types'; end if;
      if normalized_submission ? builtin_key and builtin_key in ('guardianPhone','divisionId','positionId')
        and not (builtin_key='positionId' and normalized_submission->builtin_key='null'::jsonb)
        and (jsonb_typeof(normalized_submission->builtin_key) is distinct from 'string'
          or (builtin_key='guardianPhone' and public.canonical_registration_text(normalized_submission->>builtin_key)=''))
      then raise invalid_parameter_value using message='invalid registration identity/contact types'; end if;
      continue;
    end if;
    if normalized_submission ? builtin_key and normalized_submission->builtin_key<>'null'::jsonb
      and jsonb_typeof(normalized_submission->builtin_key) is distinct from 'string'
    then raise invalid_parameter_value using message='invalid registration identity/contact types'; end if;
    builtin_value:=public.canonical_registration_text(normalized_submission->>builtin_key);
    if not (builtin->>'enabled')::boolean then
      if coalesce(builtin_value,'')<>'' then raise invalid_parameter_value using message='hidden registration field supplied'; end if;
      normalized_submission:=normalized_submission-builtin_key;
      continue;
    end if;
    if coalesce(builtin_value,'')='' then
      if (builtin->>'required')::boolean and (builtin_key<>'divisionId' or (
        select count(*) from public.tryout_divisions d join public.tryouts t on t.organization_id=d.organization_id and t.id=d.tryout_id where t.slug=p_tryout_slug
      )>1) then raise invalid_parameter_value using message='required registration field missing'; end if;
      normalized_submission:=normalized_submission-builtin_key;
    end if;
  end loop;
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
  if normalized_submission ? 'guardianName' then
    normalized_submission:=jsonb_set(
      normalized_submission,'{guardianName}',
      to_jsonb(public.canonical_registration_text(normalized_submission->>'guardianName'))
    );
  end if;
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
    or (normalized_submission ? 'guardianName' and char_length(normalized_submission->>'guardianName') not between 1 and 160)
    or not public.is_valid_registration_email(normalized_submission->>'guardianEmail')
    or (
      normalized_submission?'guardianPhone'
      and not public.is_valid_registration_phone(normalized_submission->>'guardianPhone')
    )
    or (normalized_submission ? 'birthDate' and (not public.is_valid_registration_calendar_date(normalized_submission->>'birthDate')
      or (normalized_submission->>'birthDate')::date>current_date))
  then
    raise exception 'invalid registration identity/contact values' using errcode='22023';
  end if;

  if schema_record is not null then
    normalized_submission:=jsonb_set(normalized_submission,'{responses}',
      private.normalize_registration_responses(schema_record,normalized_submission->'responses'));
  end if;
  return normalized_submission;
end;
$$;


revoke all on function private.normalize_public_registration_submission(text,jsonb,jsonb) from public,anon,authenticated,service_role;
create or replace function private.normalize_public_registration_submission(p_tryout_slug text,p_submission jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare selected_schema jsonb;
begin
  select v.schema into selected_schema from public.tryouts t
  join public.tryout_registration_form_selections s on s.organization_id=t.organization_id and s.tryout_id=t.id
  join public.registration_form_versions v on v.organization_id=s.organization_id and v.tryout_id=s.tryout_id and v.id=s.registration_form_version_id
  where t.slug=p_tryout_slug and v.status='published';
  return private.normalize_public_registration_submission(p_tryout_slug,p_submission,selected_schema);
end $$;

-- Preserve the public transaction, rate limiting, NFC duplicate checks, and
-- confirmation tokens while validating configurable identity before insertion.
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
  validation_schema jsonb;
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

  validation_schema:=version.schema;
  if validation_schema ? 'builtInFields' then
    validation_schema:=jsonb_set(validation_schema,'{builtInFields}',(select jsonb_agg(
      case when item->>'key'='positionId' then item||'{"required":false}'::jsonb else item end)
      from jsonb_array_elements(validation_schema->'builtInFields') item));
  end if;
  p_submission:=private.normalize_public_registration_submission(p_tryout_slug,p_submission,validation_schema)-'positionId';
  v_given_name:=p_submission->>'givenName';
  v_family_name:=p_submission->>'familyName';
  v_guardian_name:=p_submission->>'guardianName';
  v_guardian_email:=public.normalize_registration_text(p_submission->>'guardianEmail');
  v_guardian_phone:=p_submission->>'guardianPhone';
  v_birth_date:=nullif(p_submission->>'birthDate','')::date;

  selected_division:=nullif(p_submission->>'divisionId','')::uuid;
  if selected_division is null then
    select id into selected_division
    from public.tryout_divisions
    where organization_id=target.organization_id and tryout_id=target.id
    order by sort_order,id limit 1;
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

-- The canonical outer boundary and base transaction now share validation;
-- this internal wrapper retains phone persistence and confirmation replay.
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
  effective_schema jsonb;
begin
  if p_tryout_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
    or p_idempotency_key !~ '^[A-Za-z0-9_-]{24,200}$'
    or p_rate_key_hash !~ '^[0-9a-f]{64}$'
  then
    raise exception 'invalid public registration request' using errcode='22023';
  end if;

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
  valid_key:=encode(extensions.digest(p_idempotency_key,'sha256'),'hex');
  select registration.* into existing_registration from public.tryout_registrations registration
  where registration.organization_id=target_organization and registration.tryout_id=target_tryout
    and registration.submission_key_digest=valid_key for update;
  if found then
    select schema into effective_schema from public.registration_form_versions
    where organization_id=target_organization and tryout_id=target_tryout and id=existing_registration.registration_form_version_id;
  else
    select v.schema into effective_schema from public.tryout_registration_form_selections s
    join public.registration_form_versions v on v.organization_id=s.organization_id and v.tryout_id=s.tryout_id and v.id=s.registration_form_version_id
    where s.organization_id=target_organization and s.tryout_id=target_tryout;
  end if;
  raw_historical_submission:=p_submission-'positionId';
  normalized_submission:=private.normalize_public_registration_submission(
    p_tryout_slug,p_submission,effective_schema
  );
  normalized_025_historical_submission:=normalized_submission-'positionId';
  if p_submission ? 'divisionId' then
    normalized_025_historical_submission:=jsonb_set(normalized_025_historical_submission,'{divisionId}',p_submission->'divisionId');
  end if;
  requested_position:=nullif(normalized_submission->>'positionId','')::uuid;
  requested_division:=nullif(normalized_submission->>'divisionId','')::uuid;
  internal_submission:=normalized_submission-'positionId';

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


create or replace function public.create_staff_registration(
  p_organization_id uuid,
  p_tryout_id uuid,
  p_existing_athlete_id uuid,
  p_division_id uuid,
  p_position_id uuid,
  p_given_name text,
  p_family_name text,
  p_birth_date date,
  p_responses jsonb,
  p_submission_key_digest text
) returns table(outcome text,registration_id uuid,athlete_id uuid)
language plpgsql security definer set search_path=''
as $$
declare
  target public.tryouts%rowtype;
  athlete public.athletes%rowtype;
  version public.registration_form_versions%rowtype;
  existing_registration public.tryout_registrations%rowtype;
  created_registration public.tryout_registrations%rowtype;
  normalized_responses jsonb;
  normalized_given_name text;
  normalized_family_name text;
  request_digest text;
begin
  if auth.uid() is null or not public.can_manage_tryout_root(p_organization_id,p_tryout_id) then
    raise insufficient_privilege using message='forbidden';
  end if;
  if p_submission_key_digest is null or p_submission_key_digest!~'^[0-9a-f]{64}$'
    or p_responses is null or jsonb_typeof(p_responses)<>'object'
    or (
      p_existing_athlete_id is null
      and (
        p_given_name is null
        or p_family_name is null
      )
    )
    or (
      p_existing_athlete_id is not null
      and (p_given_name is not null or p_family_name is not null or p_birth_date is not null)
    )
  then
    raise invalid_parameter_value using message='invalid staff registration';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    concat_ws(':','staff-registration',p_organization_id,p_tryout_id,p_submission_key_digest),0
  ));
  select * into target from public.tryouts item
  where item.organization_id=p_organization_id
    and item.id=p_tryout_id
    and item.status in('draft','published')
  for share;
  if not found then
    return query select 'not_found'::text,null::uuid,null::uuid;
    return;
  end if;
  select form_version.* into version
  from public.tryout_registration_form_selections selection
  join public.registration_form_versions form_version
    on form_version.organization_id=selection.organization_id
      and form_version.tryout_id=selection.tryout_id
      and form_version.id=selection.registration_form_version_id
  where selection.organization_id=p_organization_id
    and selection.tryout_id=p_tryout_id
    and form_version.status in('draft','published')
  for share of selection,form_version;
  if not found then
    return query select 'form_missing'::text,null::uuid,null::uuid;
    return;
  end if;

  if p_existing_athlete_id is null and p_birth_date is null
    and (private.registration_builtin_field(version.schema,'birthDate')->>'enabled')::boolean
    and (private.registration_builtin_field(version.schema,'birthDate')->>'required')::boolean
  then raise invalid_parameter_value using message='required athlete birth date missing'; end if;
  if p_existing_athlete_id is null and p_birth_date is not null
    and not (private.registration_builtin_field(version.schema,'birthDate')->>'enabled')::boolean
  then raise invalid_parameter_value using message='hidden athlete birth date supplied'; end if;
  if (private.registration_builtin_field(version.schema,'positionId')->>'enabled')::boolean
    and (private.registration_builtin_field(version.schema,'positionId')->>'required')::boolean
    and p_position_id is null
  then raise invalid_parameter_value using message='required registration position missing'; end if;
  normalized_responses:=private.normalize_registration_responses(version.schema,p_responses);
  if p_existing_athlete_id is null then
    normalized_given_name:=public.canonical_registration_text(p_given_name);
    normalized_family_name:=public.canonical_registration_text(p_family_name);
    if char_length(normalized_given_name) not between 1 and 120
      or char_length(normalized_family_name) not between 1 and 120
      or p_birth_date>current_date
    then
      raise invalid_parameter_value using message='invalid athlete identity';
    end if;
  end if;
  request_digest:=encode(extensions.digest(convert_to(jsonb_build_object(
    'digest_version',1,
    'organization_id',p_organization_id,
    'tryout_id',p_tryout_id,
    'form_version_id',version.id,
    'existing_athlete_id',p_existing_athlete_id,
    'given_name',normalized_given_name,
    'family_name',normalized_family_name,
    'birth_date',p_birth_date,
    'division_id',p_division_id,
    'position_id',p_position_id,
    'responses',normalized_responses
  )::text,'UTF8'),'sha256'),'hex');

  select * into existing_registration from public.tryout_registrations item
  where item.organization_id=p_organization_id
    and item.tryout_id=p_tryout_id
    and item.submission_key_digest=p_submission_key_digest
  for update;
  if found then
    if existing_registration.source='staff'
      and existing_registration.staff_request_digest=request_digest
    then
      return query select 'replayed'::text,existing_registration.id,existing_registration.athlete_id;
    else
      return query select 'idempotency_conflict'::text,null::uuid,null::uuid;
    end if;
    return;
  end if;

  if not exists(
    select 1 from public.tryout_divisions division
    where division.organization_id=p_organization_id
      and division.tryout_id=p_tryout_id
      and division.id=p_division_id
  ) or (
    p_position_id is not null and not exists(
      select 1 from public.tryout_positions position
      where position.organization_id=p_organization_id
        and position.tryout_id=p_tryout_id
        and position.id=p_position_id
    )
  ) then
    raise invalid_parameter_value using message='invalid registration placement';
  end if;
  if p_existing_athlete_id is not null then
    select * into athlete from public.athletes item
    where item.organization_id=p_organization_id and item.id=p_existing_athlete_id
    for share;
    if not found then
      return query select 'athlete_not_found'::text,null::uuid,null::uuid;
      return;
    end if;
  else
    insert into public.athletes(
      organization_id,given_name,family_name,normalized_given_name,
      normalized_family_name,birth_date
    ) values(
      p_organization_id,normalized_given_name,normalized_family_name,
      public.normalize_registration_text(normalized_given_name),
      public.normalize_registration_text(normalized_family_name),p_birth_date
    ) returning * into athlete;
  end if;

  insert into public.tryout_registrations(
    organization_id,tryout_id,athlete_id,division_id,position_id,
    registration_form_version_id,responses,source,submission_key_digest,
    submission_digest,submission_digest_version,staff_request_digest
  ) values(
    p_organization_id,p_tryout_id,athlete.id,p_division_id,p_position_id,
    version.id,normalized_responses,'staff',p_submission_key_digest,
    request_digest,2,request_digest
  ) returning * into created_registration;
  insert into public.session_enrollments(
    organization_id,tryout_id,registration_id,session_id
  )
  select p_organization_id,p_tryout_id,created_registration.id,session.id
  from public.tryout_sessions session
  where session.organization_id=p_organization_id
    and session.tryout_id=p_tryout_id
    and session.division_id=p_division_id;
  insert into public.audit_logs(
    organization_id,actor_user_id,action,entity_type,entity_id,details
  ) values(
    p_organization_id,auth.uid(),'registration.staff_created','tryout_registration',
    created_registration.id,jsonb_build_object(
      'athleteId',athlete.id,
      'tryoutId',p_tryout_id,
      'returningAthlete',p_existing_athlete_id is not null
    )
  );
  return query select 'created'::text,created_registration.id,athlete.id;
end;
$$;


-- Restate the closed public submission and staff implementation ACLs.
revoke all on function public.submit_public_registration(text,jsonb,text,text),
  public.submit_public_registration_with_phone(text,jsonb,text,text),
  public.submit_public_registration_v2(text,jsonb,text,text),
  public.create_staff_registration(uuid,uuid,uuid,uuid,uuid,text,text,date,jsonb,text)
from public,anon,authenticated,service_role;
