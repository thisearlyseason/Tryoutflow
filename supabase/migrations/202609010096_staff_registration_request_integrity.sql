-- Exceptional final closure: staff registration now shares one authoritative
-- immutable-form response validator with the registration table boundary and
-- compares a canonical request digest before any idempotent replay.

create function private.normalize_registration_responses(
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

create or replace function public.assert_strict_registration_response_values()
returns trigger language plpgsql set search_path=''
as $$
declare schema_record jsonb;
begin
  select version.schema into schema_record
  from public.registration_form_versions version
  where version.organization_id=new.organization_id
    and version.tryout_id=new.tryout_id
    and version.id=new.registration_form_version_id;
  new.responses:=private.normalize_registration_responses(schema_record,new.responses);
  return new;
end;
$$;

alter table public.tryout_registrations
  add column staff_request_digest text,
  add constraint tryout_registrations_staff_request_digest_check check(
    staff_request_digest is null or (
      source='staff' and staff_request_digest~'^[0-9a-f]{64}$'
    )
  );

create function private.prevent_staff_request_digest_mutation()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
  if old.staff_request_digest is distinct from new.staff_request_digest then
    raise object_not_in_prerequisite_state using message='staff registration request evidence is immutable';
  end if;
  return new;
end;
$$;

create trigger prevent_staff_request_digest_mutation
before update of staff_request_digest on public.tryout_registrations
for each row execute function private.prevent_staff_request_digest_mutation();

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
        or p_birth_date is null
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

revoke all on function private.normalize_registration_responses(jsonb,jsonb)
  from public,anon,authenticated,service_role;
revoke all on function private.prevent_staff_request_digest_mutation()
  from public,anon,authenticated,service_role;
revoke all on function public.create_staff_registration(
  uuid,uuid,uuid,uuid,uuid,text,text,date,jsonb,text
) from public,anon,authenticated,service_role;
grant execute on function public.create_staff_registration(
  uuid,uuid,uuid,uuid,uuid,text,text,date,jsonb,text
) to authenticated;
