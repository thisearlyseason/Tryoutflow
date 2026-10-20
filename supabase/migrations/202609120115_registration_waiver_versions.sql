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
    or new.schema - array['fields'] <> '{}'::jsonb
    or jsonb_typeof(new.schema -> 'fields') <> 'array'
    or jsonb_array_length(new.schema -> 'fields') > 100
  then
    raise exception 'registration form schema requires a fields array' using errcode = '23514';
  end if;

  for field in select value from jsonb_array_elements(new.schema -> 'fields') loop
    if jsonb_typeof(field) <> 'object'
      or field - array['key', 'label', 'kind', 'required', 'sortOrder', 'helpText', 'options', 'waiverText'] <> '{}'::jsonb
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

  return new;
end;
$$;

create function public.public_registration_tryout_v3(p_tryout_slug text)
returns table(
  tryout_id uuid,
  name text,
  slug text,
  form_schema jsonb,
  divisions jsonb,
  positions jsonb,
  organization_name text,
  organization_slug text,
  logo_exists boolean,
  form_version_id uuid
)
language plpgsql stable security definer set search_path=''
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'forbidden' using errcode='42501';
  end if;
  return query select
    target.id,
    target.name,
    target.slug,
    version.schema,
    coalesce((
      select jsonb_agg(
        jsonb_build_object('id',division.id,'name',division.name)
        order by division.sort_order,division.id
      )
      from public.tryout_divisions division
      where division.organization_id=target.organization_id
        and division.tryout_id=target.id
    ),'[]'::jsonb),
    coalesce((
      select jsonb_agg(
        jsonb_build_object('id',position.id,'name',position.name)
        order by position.sort_order,position.id
      )
      from public.tryout_positions position
      where position.organization_id=target.organization_id
        and position.tryout_id=target.id
    ),'[]'::jsonb),
    organization.name,
    organization.slug,
    asset.organization_id is not null,
    version.id
  from public.tryouts target
  join public.organizations organization
    on organization.id=target.organization_id
  join public.tryout_registration_form_selections selection
    on selection.organization_id=target.organization_id
    and selection.tryout_id=target.id
  join public.registration_form_versions version
    on version.organization_id=selection.organization_id
    and version.tryout_id=selection.tryout_id
    and version.id=selection.registration_form_version_id
    and version.status='published'
  left join private.organization_brand_assets asset
    on asset.organization_id=target.organization_id
  where target.slug=p_tryout_slug
    and target.status='published'
    and target.registration_starts_at<=clock_timestamp()
    and target.registration_ends_at>clock_timestamp();
end;
$$;

revoke all privileges on function public.public_registration_tryout_v3(text)
  from public,anon,authenticated,service_role;
grant execute on function public.public_registration_tryout_v3(text) to service_role;

-- Lock before comparing versions. All supported form-publication commands take
-- this same tryout lock, so a concurrent revision cannot slip between this
-- comparison and the inner registration insert. No GUC grants a bypass.
create function public.submit_public_registration_with_notification_v2(
  p_tryout_slug text,
  p_submission jsonb,
  p_idempotency_key text,
  p_rate_key_hash text,
  p_app_origin text,
  p_expected_form_version_id uuid
) returns table(outcome text,registration_id uuid,confirmation_token text)
language plpgsql security definer set search_path='' as $$
declare
  target_tryout uuid;
  target_organization uuid;
  selected_version uuid;
  accepted_version uuid;
  valid_key text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'forbidden' using errcode='42501';
  end if;

  select target.id,target.organization_id into target_tryout,target_organization
  from public.tryouts target
  where target.slug=p_tryout_slug and target.status='published'
    and target.registration_starts_at<=clock_timestamp()
    and target.registration_ends_at>clock_timestamp()
  for update;
  if not found then
    return query select 'registration_closed'::text,null::uuid,null::text;
    return;
  end if;

  select version.id into selected_version
  from public.tryout_registration_form_selections selection
  join public.registration_form_versions version
    on version.organization_id=selection.organization_id
    and version.tryout_id=selection.tryout_id
    and version.id=selection.registration_form_version_id
    and version.status='published'
  where selection.organization_id=target_organization
    and selection.tryout_id=target_tryout
  for update of selection,version;

  valid_key:=encode(extensions.digest(p_idempotency_key,'sha256'),'hex');
  select registration.registration_form_version_id into accepted_version
  from public.tryout_registrations registration
  where registration.organization_id=target_organization
    and registration.tryout_id=target_tryout
    and registration.submission_key_digest=valid_key
  for update;

  -- The accepted key may replay its original version after a revision. This
  -- is only permission to enter the existing full payload-digest checks;
  -- a changed request still conflicts and cannot rotate confirmation tokens.
  if p_expected_form_version_id is null
    or (accepted_version is not null and
      p_expected_form_version_id is distinct from accepted_version)
    or (accepted_version is null and
      p_expected_form_version_id is distinct from selected_version)
  then
    return query select 'form_changed'::text,null::uuid,null::text;
    return;
  end if;

  return query select * from public.submit_public_registration_with_notification(
    p_tryout_slug,p_submission,p_idempotency_key,p_rate_key_hash,p_app_origin
  );
end;
$$;
revoke all on function public.submit_public_registration_with_notification_v2(text,jsonb,text,text,text,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.submit_public_registration_with_notification_v2(text,jsonb,text,text,text,uuid)
  to service_role;
-- Retain the old service wrapper only until the application uses this binding.
-- Apply migration 116 after application promotion to close that entry point.

-- Staff forms can use draft versions. Compare the entire rendered schema so
-- an edit within the same draft version cannot change the accepted wording.
create function public.create_staff_registration_v2(
  p_organization_id uuid,
  p_tryout_id uuid,
  p_existing_athlete_id uuid,
  p_division_id uuid,
  p_position_id uuid,
  p_given_name text,
  p_family_name text,
  p_birth_date date,
  p_responses jsonb,
  p_submission_key_digest text,
  p_expected_form_schema jsonb
) returns table(outcome text,registration_id uuid,athlete_id uuid)
language plpgsql security definer set search_path='' as $$
declare
  selected_schema jsonb;
  selected_version uuid;
  submitted record;
begin
  if auth.uid() is null or not public.can_manage_tryout_root(p_organization_id,p_tryout_id) then
    raise insufficient_privilege using message='forbidden';
  end if;
  perform 1 from public.tryouts target
  where target.organization_id=p_organization_id and target.id=p_tryout_id
    and target.status in ('draft','published')
  for update;
  if not found then
    return query select 'not_found'::text,null::uuid,null::uuid;
    return;
  end if;
  select version.schema,version.id into selected_schema,selected_version
  from public.tryout_registration_form_selections selection
  join public.registration_form_versions version
    on version.organization_id=selection.organization_id
    and version.tryout_id=selection.tryout_id
    and version.id=selection.registration_form_version_id
    and version.status in ('draft','published')
  where selection.organization_id=p_organization_id and selection.tryout_id=p_tryout_id
  for update of selection,version;
  if not found then
    return query select 'form_missing'::text,null::uuid,null::uuid;
    return;
  end if;
  if p_expected_form_schema is null or p_expected_form_schema is distinct from selected_schema then
    return query select 'form_changed'::text,null::uuid,null::uuid;
    return;
  end if;
  select * into submitted from public.create_staff_registration(
    p_organization_id,p_tryout_id,p_existing_athlete_id,p_division_id,p_position_id,
    p_given_name,p_family_name,p_birth_date,p_responses,p_submission_key_digest
  );
  if not found then raise exception 'registration_outcome_missing' using errcode='XX000'; end if;
  if submitted.outcome in ('created','replayed') and exists (
    select 1 from jsonb_array_elements(selected_schema->'fields') field
    where field->>'kind'='consent' and field ? 'waiverText'
  ) then
    -- Freeze only this form snapshot; the tryout itself remains a draft.
    -- The wizard creates a new version on the next edit, retaining these terms.
    update public.registration_form_versions version
    set status='published',published_at=coalesce(version.published_at,clock_timestamp())
    where version.organization_id=p_organization_id and version.tryout_id=p_tryout_id
      and version.id=selected_version and version.status='draft';
  end if;
  return query select submitted.outcome::text,submitted.registration_id::uuid,submitted.athlete_id::uuid;
end;
$$;
revoke all on function public.create_staff_registration_v2(uuid,uuid,uuid,uuid,uuid,text,text,date,jsonb,text,jsonb)
  from public,anon,authenticated,service_role;
grant execute on function public.create_staff_registration_v2(uuid,uuid,uuid,uuid,uuid,text,text,date,jsonb,text,jsonb)
  to authenticated;
