create table public.registration_forms (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  tryout_id uuid not null,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint registration_forms_organization_id_id_key unique (organization_id, id),
  constraint registration_forms_organization_tryout_id_key unique (organization_id, tryout_id, id),
  constraint registration_forms_tryout_fkey foreign key (organization_id, tryout_id)
    references public.tryouts (organization_id, id) on delete cascade,
  constraint registration_forms_name_not_blank check (char_length(trim(name)) between 1 and 120),
  constraint registration_forms_name_key unique (organization_id, tryout_id, name)
);

create table public.registration_form_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  tryout_id uuid not null,
  registration_form_id uuid not null,
  version_number integer not null,
  schema jsonb not null,
  status text not null default 'draft',
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint registration_form_versions_organization_id_id_key unique (organization_id, id),
  constraint registration_form_versions_organization_tryout_id_key unique (organization_id, tryout_id, id),
  constraint registration_form_versions_form_fkey foreign key (organization_id, tryout_id, registration_form_id)
    references public.registration_forms (organization_id, tryout_id, id) on delete restrict,
  constraint registration_form_versions_number_positive check (version_number > 0),
  constraint registration_form_versions_status check (status in ('draft', 'published')),
  constraint registration_form_versions_lifecycle check (
    (status = 'draft' and published_at is null) or (status = 'published' and published_at is not null)
  ),
  constraint registration_form_versions_schema_object check (jsonb_typeof(schema) = 'object'),
  constraint registration_form_versions_number_key unique (organization_id, registration_form_id, version_number)
);

create unique index registration_form_versions_one_draft_per_form_idx
  on public.registration_form_versions (organization_id, registration_form_id)
  where status = 'draft';

create index registration_form_versions_tryout_idx
  on public.registration_form_versions (organization_id, tryout_id, registration_form_id, version_number);

create table public.rubrics (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  tryout_id uuid not null,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint rubrics_organization_id_id_key unique (organization_id, id),
  constraint rubrics_organization_tryout_id_key unique (organization_id, tryout_id, id),
  constraint rubrics_tryout_fkey foreign key (organization_id, tryout_id)
    references public.tryouts (organization_id, id) on delete cascade,
  constraint rubrics_name_not_blank check (char_length(trim(name)) between 1 and 120),
  constraint rubrics_name_key unique (organization_id, tryout_id, name)
);

create table public.rubric_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  tryout_id uuid not null,
  rubric_id uuid not null,
  version_number integer not null,
  status text not null default 'draft',
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint rubric_versions_organization_id_id_key unique (organization_id, id),
  constraint rubric_versions_organization_tryout_id_key unique (organization_id, tryout_id, id),
  constraint rubric_versions_rubric_fkey foreign key (organization_id, tryout_id, rubric_id)
    references public.rubrics (organization_id, tryout_id, id) on delete restrict,
  constraint rubric_versions_number_positive check (version_number > 0),
  constraint rubric_versions_status check (status in ('draft', 'published')),
  constraint rubric_versions_lifecycle check (
    (status = 'draft' and published_at is null) or (status = 'published' and published_at is not null)
  ),
  constraint rubric_versions_number_key unique (organization_id, rubric_id, version_number)
);

create unique index rubric_versions_one_draft_per_rubric_idx
  on public.rubric_versions (organization_id, rubric_id)
  where status = 'draft';

create index rubric_versions_tryout_idx
  on public.rubric_versions (organization_id, tryout_id, rubric_id, version_number);

create table public.rubric_categories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  tryout_id uuid not null,
  rubric_version_id uuid not null,
  name text not null,
  description text,
  sort_order integer not null,
  weight numeric(5, 2) not null,
  scale_min integer not null,
  scale_max integer not null,
  guidance text,
  is_priority boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint rubric_categories_organization_id_id_key unique (organization_id, id),
  constraint rubric_categories_organization_tryout_version_id_key unique (organization_id, tryout_id, rubric_version_id, id),
  constraint rubric_categories_version_fkey foreign key (organization_id, tryout_id, rubric_version_id)
    references public.rubric_versions (organization_id, tryout_id, id) on delete restrict,
  constraint rubric_categories_name_not_blank check (char_length(trim(name)) between 1 and 120),
  constraint rubric_categories_description_length check (description is null or char_length(description) <= 2000),
  constraint rubric_categories_guidance_length check (guidance is null or char_length(guidance) <= 4000),
  constraint rubric_categories_sort_order_nonnegative check (sort_order >= 0),
  constraint rubric_categories_weight_range check (weight > 0 and weight <= 100),
  constraint rubric_categories_scale check (scale_min = 1 and scale_max in (5, 10)),
  constraint rubric_categories_order_key unique (organization_id, rubric_version_id, sort_order),
  constraint rubric_categories_name_key unique (organization_id, rubric_version_id, name)
);

create index rubric_categories_version_idx
  on public.rubric_categories (organization_id, tryout_id, rubric_version_id, sort_order);

create table public.session_rubrics (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  tryout_id uuid not null,
  session_id uuid not null,
  rubric_version_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint session_rubrics_organization_id_id_key unique (organization_id, id),
  constraint session_rubrics_session_fkey foreign key (organization_id, tryout_id, session_id)
    references public.tryout_sessions (organization_id, tryout_id, id) on delete cascade,
  constraint session_rubrics_version_fkey foreign key (organization_id, tryout_id, rubric_version_id)
    references public.rubric_versions (organization_id, tryout_id, id) on delete restrict,
  constraint session_rubrics_session_key unique (organization_id, session_id)
);

create function public.assert_valid_registration_form_schema()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  field jsonb;
begin
  if jsonb_typeof(new.schema) <> 'object' or jsonb_typeof(new.schema -> 'fields') <> 'array' then
    raise exception 'registration form schema requires a fields array' using errcode = '23514';
  end if;

  for field in select value from jsonb_array_elements(new.schema -> 'fields') loop
    if jsonb_typeof(field) <> 'object'
      or field - array['key', 'label', 'kind', 'required', 'sortOrder', 'helpText', 'options'] <> '{}'::jsonb
      or coalesce(field ->> 'key', '') !~ '^[a-z][a-z0-9_]{0,62}$'
      or char_length(trim(coalesce(field ->> 'label', ''))) not between 1 and 120
      or coalesce(field ->> 'kind', '') not in ('text', 'email', 'phone', 'date', 'select', 'checkbox', 'textarea', 'consent')
      or jsonb_typeof(field -> 'required') <> 'boolean'
      or coalesce(field ->> 'sortOrder', '') !~ '^(0|[1-9][0-9]*)$'
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
    select 1
    from jsonb_array_elements(new.schema -> 'fields') as item
    group by item.value ->> 'key'
    having count(*) > 1
  ) or exists (
    select 1
    from jsonb_array_elements(new.schema -> 'fields') as item
    group by item.value ->> 'sortOrder'
    having count(*) > 1
  ) then
    raise exception 'registration form fields require unique keys and ordering' using errcode = '23514';
  end if;

  return new;
end;
$$;

create function public.prevent_published_registration_form_version_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and old.status = 'published' then
    raise exception 'published registration form versions are immutable' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' then
    if old.organization_id is distinct from new.organization_id
      or old.tryout_id is distinct from new.tryout_id
      or old.registration_form_id is distinct from new.registration_form_id
      or old.version_number is distinct from new.version_number then
      raise exception 'registration form version identity is immutable' using errcode = '23514';
    end if;
    if old.status = 'published' and (to_jsonb(new) - 'updated_at') is distinct from (to_jsonb(old) - 'updated_at') then
      raise exception 'published registration form versions are immutable' using errcode = '23514';
    end if;
  end if;
  return coalesce(new, old);
end;
$$;

create function public.prevent_published_rubric_version_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and old.status = 'published' then
    raise exception 'published rubric versions are immutable' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' then
    if old.organization_id is distinct from new.organization_id
      or old.tryout_id is distinct from new.tryout_id
      or old.rubric_id is distinct from new.rubric_id
      or old.version_number is distinct from new.version_number then
      raise exception 'rubric version identity is immutable' using errcode = '23514';
    end if;
    if old.status = 'published' and (to_jsonb(new) - 'updated_at') is distinct from (to_jsonb(old) - 'updated_at') then
      raise exception 'published rubric versions are immutable' using errcode = '23514';
    end if;
  end if;
  return coalesce(new, old);
end;
$$;

create function public.prevent_published_rubric_category_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  version_status text;
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

  select status into version_status
  from public.rubric_versions
  where organization_id = target_organization_id
    and tryout_id = target_tryout_id
    and id = target_version_id;

  if version_status = 'published' then
    raise exception 'published rubric categories are immutable' using errcode = '23514';
  end if;
  return coalesce(new, old);
end;
$$;

create function public.assert_session_rubric_is_published()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.rubric_versions
    where organization_id = new.organization_id
      and tryout_id = new.tryout_id
      and id = new.rubric_version_id
      and status <> 'published'
  ) then
    raise exception 'session rubrics require a published rubric version' using errcode = '23514';
  end if;
  return new;
end;
$$;

create function public.prevent_published_session_rubric_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  target_organization_id uuid := coalesce(new.organization_id, old.organization_id);
  target_tryout_id uuid := coalesce(new.tryout_id, old.tryout_id);
  target_status text;
begin
  select status into target_status from public.tryouts where organization_id = target_organization_id and id = target_tryout_id;
  if target_status in ('published', 'finalized') then
    raise exception 'published tryout configuration is immutable' using errcode = '23514';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger a_set_registration_forms_updated_at before update on public.registration_forms
for each row execute function public.set_updated_at();
create trigger a_assert_registration_form_schema before insert or update of schema on public.registration_form_versions
for each row execute function public.assert_valid_registration_form_schema();
create trigger b_set_registration_form_versions_updated_at before update on public.registration_form_versions
for each row execute function public.set_updated_at();
create trigger z_prevent_published_registration_form_version_mutation before update or delete on public.registration_form_versions
for each row execute function public.prevent_published_registration_form_version_mutation();
create trigger a_set_rubrics_updated_at before update on public.rubrics
for each row execute function public.set_updated_at();
create trigger a_set_rubric_versions_updated_at before update on public.rubric_versions
for each row execute function public.set_updated_at();
create trigger z_prevent_published_rubric_version_mutation before update or delete on public.rubric_versions
for each row execute function public.prevent_published_rubric_version_mutation();
create trigger a_set_rubric_categories_updated_at before update on public.rubric_categories
for each row execute function public.set_updated_at();
create trigger z_prevent_published_rubric_category_mutation before update or delete on public.rubric_categories
for each row execute function public.prevent_published_rubric_category_mutation();
create trigger a_assert_session_rubric_is_published before insert or update of rubric_version_id on public.session_rubrics
for each row execute function public.assert_session_rubric_is_published();
create trigger b_set_session_rubrics_updated_at before update on public.session_rubrics
for each row execute function public.set_updated_at();
create trigger z_prevent_published_session_rubric_mutation before update or delete on public.session_rubrics
for each row execute function public.prevent_published_session_rubric_mutation();

create function public.publish_registration_form_version(p_organization_id uuid, p_version_id uuid, p_expected_version integer)
returns table (outcome text, version_id uuid)
language plpgsql security definer set search_path = '' as $$
declare
  target public.registration_form_versions%rowtype;
begin
  select version.* into target
  from public.registration_form_versions as version
  where version.organization_id = p_organization_id and version.id = p_version_id
  for update;
  if not found then return query select 'not_found'::text, null::uuid; return; end if;
  if not public.can_manage_tryout_root(p_organization_id, target.tryout_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  if target.status <> 'draft' or target.version_number <> p_expected_version then
    return query select 'conflict'::text, target.id;
    return;
  end if;
  update public.registration_form_versions
  set status = 'published', published_at = clock_timestamp()
  where id = target.id and organization_id = target.organization_id and status = 'draft'
  returning id into target.id;
  if not found then return query select 'conflict'::text, null::uuid; return; end if;
  return query select 'published'::text, target.id;
end;
$$;

create function public.publish_rubric_version(p_organization_id uuid, p_rubric_id uuid, p_expected_version integer)
returns table (outcome text, version_id uuid)
language plpgsql security definer set search_path = '' as $$
declare
  target public.rubric_versions%rowtype;
  total_weight numeric(8, 2);
begin
  if not public.can_manage_tryout_root(
    p_organization_id,
    (select tryout_id from public.rubrics where organization_id = p_organization_id and id = p_rubric_id)
  ) then raise exception 'forbidden' using errcode = '42501'; end if;

  select version.* into target
  from public.rubric_versions as version
  where version.organization_id = p_organization_id
    and version.rubric_id = p_rubric_id
    and version.status = 'draft'
  for update;
  if not found then return query select 'conflict'::text, null::uuid; return; end if;
  if target.version_number <> p_expected_version then return query select 'conflict'::text, target.id; return; end if;

  select coalesce(sum(category.weight), 0) into total_weight
  from public.rubric_categories as category
  where category.organization_id = target.organization_id and category.rubric_version_id = target.id;
  if total_weight <> 100 then return query select 'invalid_draft'::text, target.id; return; end if;

  update public.rubric_versions
  set status = 'published', published_at = clock_timestamp()
  where id = target.id and organization_id = target.organization_id and status = 'draft'
  returning id into target.id;
  if not found then return query select 'conflict'::text, null::uuid; return; end if;
  return query select 'published'::text, target.id;
end;
$$;

create function public.create_rubric_revision(p_organization_id uuid, p_rubric_id uuid, p_source_version_id uuid)
returns table (outcome text, version_id uuid, version_number integer)
language plpgsql security definer set search_path = '' as $$
declare
  rubric public.rubrics%rowtype;
  source public.rubric_versions%rowtype;
  created_version public.rubric_versions%rowtype;
begin
  select item.* into rubric from public.rubrics as item
  where item.organization_id = p_organization_id and item.id = p_rubric_id for update;
  if not found then return query select 'not_found'::text, null::uuid, null::integer; return; end if;
  if not public.can_manage_tryout_root(p_organization_id, rubric.tryout_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  select item.* into source from public.rubric_versions as item
  where item.organization_id = p_organization_id and item.tryout_id = rubric.tryout_id and item.rubric_id = rubric.id and item.id = p_source_version_id
  for share;
  if not found or source.status <> 'published' then return query select 'not_found'::text, null::uuid, null::integer; return; end if;

  insert into public.rubric_versions (organization_id, tryout_id, rubric_id, version_number)
  values (rubric.organization_id, rubric.tryout_id, rubric.id, (select coalesce(max(candidate.version_number), 0) + 1 from public.rubric_versions as candidate where candidate.organization_id = rubric.organization_id and candidate.rubric_id = rubric.id))
  returning * into created_version;
  insert into public.rubric_categories (organization_id, tryout_id, rubric_version_id, name, description, sort_order, weight, scale_min, scale_max, guidance, is_priority)
  select organization_id, tryout_id, created_version.id, name, description, sort_order, weight, scale_min, scale_max, guidance, is_priority
  from public.rubric_categories
  where organization_id = source.organization_id and rubric_version_id = source.id
  order by sort_order;
  return query select 'created'::text, created_version.id, created_version.version_number;
end;
$$;

create function public.create_registration_form_revision(p_organization_id uuid, p_registration_form_id uuid, p_source_version_id uuid)
returns table (outcome text, version_id uuid, version_number integer)
language plpgsql security definer set search_path = '' as $$
declare
  form public.registration_forms%rowtype;
  source public.registration_form_versions%rowtype;
  created_version public.registration_form_versions%rowtype;
begin
  select item.* into form from public.registration_forms as item
  where item.organization_id = p_organization_id and item.id = p_registration_form_id for update;
  if not found then return query select 'not_found'::text, null::uuid, null::integer; return; end if;
  if not public.can_manage_tryout_root(p_organization_id, form.tryout_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  select item.* into source from public.registration_form_versions as item
  where item.organization_id = p_organization_id and item.tryout_id = form.tryout_id and item.registration_form_id = form.id and item.id = p_source_version_id
  for share;
  if not found or source.status <> 'published' then return query select 'not_found'::text, null::uuid, null::integer; return; end if;
  insert into public.registration_form_versions (organization_id, tryout_id, registration_form_id, version_number, schema)
  values (form.organization_id, form.tryout_id, form.id, (select coalesce(max(candidate.version_number), 0) + 1 from public.registration_form_versions as candidate where candidate.organization_id = form.organization_id and candidate.registration_form_id = form.id), source.schema)
  returning * into created_version;
  return query select 'created'::text, created_version.id, created_version.version_number;
end;
$$;

alter table public.registration_forms enable row level security;
alter table public.registration_form_versions enable row level security;
alter table public.rubrics enable row level security;
alter table public.rubric_versions enable row level security;
alter table public.rubric_categories enable row level security;
alter table public.session_rubrics enable row level security;

create policy registration_forms_select_authorized on public.registration_forms for select to authenticated
using (public.can_read_tryout_configuration(organization_id, tryout_id));
create policy registration_forms_manage_root on public.registration_forms for all to authenticated
using (public.can_manage_tryout_root(organization_id, tryout_id))
with check (public.can_manage_tryout_root(organization_id, tryout_id));
create policy registration_form_versions_select_authorized on public.registration_form_versions for select to authenticated
using (public.can_read_tryout_configuration(organization_id, tryout_id));
create policy registration_form_versions_insert_draft on public.registration_form_versions for insert to authenticated
with check (status = 'draft' and public.can_manage_tryout_root(organization_id, tryout_id));
create policy registration_form_versions_update_draft on public.registration_form_versions for update to authenticated
using (status = 'draft' and public.can_manage_tryout_root(organization_id, tryout_id))
with check (status = 'draft' and public.can_manage_tryout_root(organization_id, tryout_id));
create policy registration_form_versions_delete_draft on public.registration_form_versions for delete to authenticated
using (status = 'draft' and public.can_manage_tryout_root(organization_id, tryout_id));
create policy rubrics_select_authorized on public.rubrics for select to authenticated
using (public.can_read_tryout_configuration(organization_id, tryout_id));
create policy rubrics_manage_root on public.rubrics for all to authenticated
using (public.can_manage_tryout_root(organization_id, tryout_id))
with check (public.can_manage_tryout_root(organization_id, tryout_id));
create policy rubric_versions_select_authorized on public.rubric_versions for select to authenticated
using (public.can_read_tryout_configuration(organization_id, tryout_id));
create policy rubric_versions_insert_draft on public.rubric_versions for insert to authenticated
with check (status = 'draft' and public.can_manage_tryout_root(organization_id, tryout_id));
create policy rubric_versions_update_draft on public.rubric_versions for update to authenticated
using (status = 'draft' and public.can_manage_tryout_root(organization_id, tryout_id))
with check (status = 'draft' and public.can_manage_tryout_root(organization_id, tryout_id));
create policy rubric_versions_delete_draft on public.rubric_versions for delete to authenticated
using (status = 'draft' and public.can_manage_tryout_root(organization_id, tryout_id));
create policy rubric_categories_select_authorized on public.rubric_categories for select to authenticated
using (public.can_read_tryout_configuration(organization_id, tryout_id));
create policy rubric_categories_manage_root on public.rubric_categories for all to authenticated
using (public.can_manage_tryout_root(organization_id, tryout_id))
with check (public.can_manage_tryout_root(organization_id, tryout_id));
create policy session_rubrics_select_authorized on public.session_rubrics for select to authenticated
using (public.can_read_tryout_configuration(organization_id, tryout_id, null, session_id));
create policy session_rubrics_manage_session on public.session_rubrics for all to authenticated
using (public.can_manage_tryout_session(organization_id, tryout_id, (select division_id from public.tryout_sessions where organization_id = session_rubrics.organization_id and id = session_rubrics.session_id), session_id))
with check (public.can_manage_tryout_session(organization_id, tryout_id, (select division_id from public.tryout_sessions where organization_id = session_rubrics.organization_id and id = session_rubrics.session_id), session_id));

revoke all on function public.publish_registration_form_version(uuid, uuid, integer) from public;
revoke all on function public.publish_rubric_version(uuid, uuid, integer) from public;
revoke all on function public.create_rubric_revision(uuid, uuid, uuid) from public;
revoke all on function public.create_registration_form_revision(uuid, uuid, uuid) from public;
grant execute on function public.publish_registration_form_version(uuid, uuid, integer) to authenticated;
grant execute on function public.publish_rubric_version(uuid, uuid, integer) to authenticated;
grant execute on function public.create_rubric_revision(uuid, uuid, uuid) to authenticated;
grant execute on function public.create_registration_form_revision(uuid, uuid, uuid) to authenticated;
