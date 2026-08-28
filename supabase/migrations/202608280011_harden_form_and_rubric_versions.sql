alter table public.registration_form_versions
  drop constraint registration_form_versions_number_positive,
  add constraint registration_form_versions_number_in_capacity
    check (version_number between 1 and 1000000000);

alter table public.rubric_versions
  drop constraint rubric_versions_number_positive,
  add constraint rubric_versions_number_in_capacity
    check (version_number between 1 and 1000000000);

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
      or field - array['key', 'label', 'kind', 'required', 'sortOrder', 'helpText', 'options'] <> '{}'::jsonb
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

create or replace function public.prevent_published_rubric_category_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  parent_version public.rubric_versions%rowtype;
  target_organization_id uuid := coalesce(new.organization_id, old.organization_id);
  target_tryout_id uuid := coalesce(new.tryout_id, old.tryout_id);
  target_version_id uuid := coalesce(new.rubric_version_id, old.rubric_version_id);
begin
  if tg_op = 'UPDATE' and (
    old.organization_id is distinct from new.organization_id
    or old.tryout_id is distinct from new.tryout_id
    or old.rubric_version_id is distinct from new.rubric_version_id
  ) then
    raise exception 'rubric category identity is immutable' using errcode = '23514';
  end if;

  select version.* into parent_version
  from public.rubric_versions as version
  where organization_id = target_organization_id
    and tryout_id = target_tryout_id
    and id = target_version_id
  for update;

  if parent_version.status = 'published' then
    raise exception 'published rubric categories are immutable' using errcode = '23514';
  end if;
  return coalesce(new, old);
end;
$$;

create or replace function public.create_rubric_revision(p_organization_id uuid, p_rubric_id uuid, p_source_version_id uuid)
returns table (outcome text, version_id uuid, version_number integer)
language plpgsql security definer set search_path = '' as $$
declare
  rubric public.rubrics%rowtype;
  source public.rubric_versions%rowtype;
  created_version public.rubric_versions%rowtype;
  next_version_number integer;
begin
  select item.* into rubric from public.rubrics as item
  where item.organization_id = p_organization_id and item.id = p_rubric_id for update;
  if not found then return query select 'not_found'::text, null::uuid, null::integer; return; end if;
  if not public.can_manage_tryout_root(p_organization_id, rubric.tryout_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  select item.* into source from public.rubric_versions as item
  where item.organization_id = p_organization_id and item.tryout_id = rubric.tryout_id and item.rubric_id = rubric.id and item.id = p_source_version_id
  for share;
  if not found or source.status <> 'published' then return query select 'not_found'::text, null::uuid, null::integer; return; end if;

  select coalesce(max(candidate.version_number), 0) + 1 into next_version_number
  from public.rubric_versions as candidate
  where candidate.organization_id = rubric.organization_id and candidate.rubric_id = rubric.id;
  if next_version_number > 1000000000 then
    return query select 'capacity'::text, null::uuid, null::integer;
    return;
  end if;
  insert into public.rubric_versions (organization_id, tryout_id, rubric_id, version_number)
  values (rubric.organization_id, rubric.tryout_id, rubric.id, next_version_number)
  returning * into created_version;
  insert into public.rubric_categories (organization_id, tryout_id, rubric_version_id, name, description, sort_order, weight, scale_min, scale_max, guidance, is_priority)
  select organization_id, tryout_id, created_version.id, name, description, sort_order, weight, scale_min, scale_max, guidance, is_priority
  from public.rubric_categories
  where organization_id = source.organization_id and rubric_version_id = source.id
  order by sort_order;
  return query select 'created'::text, created_version.id, created_version.version_number;
end;
$$;

create or replace function public.create_registration_form_revision(p_organization_id uuid, p_registration_form_id uuid, p_source_version_id uuid)
returns table (outcome text, version_id uuid, version_number integer)
language plpgsql security definer set search_path = '' as $$
declare
  form public.registration_forms%rowtype;
  source public.registration_form_versions%rowtype;
  created_version public.registration_form_versions%rowtype;
  next_version_number integer;
begin
  select item.* into form from public.registration_forms as item
  where item.organization_id = p_organization_id and item.id = p_registration_form_id for update;
  if not found then return query select 'not_found'::text, null::uuid, null::integer; return; end if;
  if not public.can_manage_tryout_root(p_organization_id, form.tryout_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  select item.* into source from public.registration_form_versions as item
  where item.organization_id = p_organization_id and item.tryout_id = form.tryout_id and item.registration_form_id = form.id and item.id = p_source_version_id
  for share;
  if not found or source.status <> 'published' then return query select 'not_found'::text, null::uuid, null::integer; return; end if;

  select coalesce(max(candidate.version_number), 0) + 1 into next_version_number
  from public.registration_form_versions as candidate
  where candidate.organization_id = form.organization_id and candidate.registration_form_id = form.id;
  if next_version_number > 1000000000 then
    return query select 'capacity'::text, null::uuid, null::integer;
    return;
  end if;
  insert into public.registration_form_versions (organization_id, tryout_id, registration_form_id, version_number, schema)
  values (form.organization_id, form.tryout_id, form.id, next_version_number, source.schema)
  returning * into created_version;
  return query select 'created'::text, created_version.id, created_version.version_number;
end;
$$;
