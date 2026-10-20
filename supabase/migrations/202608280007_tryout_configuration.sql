create table public.seasons (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  starts_on date,
  ends_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint seasons_organization_id_id_key unique (organization_id, id),
  constraint seasons_name_not_blank check (char_length(trim(name)) between 1 and 120),
  constraint seasons_time_range check (ends_on is null or starts_on is null or ends_on >= starts_on),
  constraint seasons_organization_name_key unique (organization_id, name)
);

create trigger set_seasons_updated_at
before update on public.seasons
for each row
execute function public.set_updated_at();

create table public.tryouts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  season_id uuid,
  name text not null,
  slug text not null,
  sport text not null,
  timezone text not null,
  description text,
  registration_starts_at timestamptz,
  registration_ends_at timestamptz,
  starts_at timestamptz,
  ends_at timestamptz,
  status text not null default 'draft',
  blind_mode boolean not null default false,
  score_visibility text not null default 'directors',
  terminology jsonb not null default '{}'::jsonb,
  published_at timestamptz,
  finalized_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tryouts_organization_id_id_key unique (organization_id, id),
  constraint tryouts_organization_season_fkey foreign key (organization_id, season_id)
    references public.seasons (organization_id, id) on delete set null (season_id),
  constraint tryouts_name_not_blank check (char_length(trim(name)) between 1 and 160),
  constraint tryouts_slug_format check (public.is_valid_organization_slug(slug)),
  constraint tryouts_sport_not_blank check (char_length(trim(sport)) between 1 and 80),
  constraint tryouts_description_length check (description is null or char_length(description) <= 5000),
  constraint tryouts_registration_time_range check (
    (registration_starts_at is null and registration_ends_at is null)
    or (registration_starts_at is not null and registration_ends_at is not null and registration_ends_at > registration_starts_at)
  ),
  constraint tryouts_event_time_range check (
    (starts_at is null and ends_at is null)
    or (starts_at is not null and ends_at is not null and ends_at > starts_at)
  ),
  constraint tryouts_status check (status in ('draft', 'published', 'finalized')),
  constraint tryouts_score_visibility check (score_visibility in ('directors', 'evaluators', 'organization')),
  constraint tryouts_terminology_object check (jsonb_typeof(terminology) = 'object'),
  constraint tryouts_lifecycle_timestamps check (
    (status = 'draft' and published_at is null and finalized_at is null)
    or (status = 'published' and published_at is not null and finalized_at is null)
    or (status = 'finalized' and published_at is not null and finalized_at is not null and finalized_at >= published_at)
  ),
  constraint tryouts_organization_slug_key unique (organization_id, slug)
);

create index tryouts_organization_status_idx on public.tryouts (organization_id, status, starts_at);

create trigger set_tryouts_updated_at
before update on public.tryouts
for each row
execute function public.set_updated_at();

create function public.assert_valid_iana_timezone()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = new.timezone) then
    raise exception 'invalid IANA timezone' using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger assert_tryouts_valid_iana_timezone
before insert or update of timezone on public.tryouts
for each row
execute function public.assert_valid_iana_timezone();

create function public.prevent_tryout_lifecycle_regression()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = new.status then
    return new;
  end if;

  if (old.status = 'draft' and new.status = 'published')
    or (old.status = 'published' and new.status = 'finalized') then
    return new;
  end if;

  raise exception 'invalid tryout lifecycle transition' using errcode = '23514';
end;
$$;

create trigger prevent_tryout_lifecycle_regression
before update of status on public.tryouts
for each row
execute function public.prevent_tryout_lifecycle_regression();

create table public.tryout_divisions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  tryout_id uuid not null,
  name text not null,
  description text,
  min_age integer,
  max_age integer,
  sort_order integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tryout_divisions_organization_id_id_key unique (organization_id, id),
  constraint tryout_divisions_organization_tryout_id_key unique (organization_id, tryout_id, id),
  constraint tryout_divisions_tryout_fkey foreign key (organization_id, tryout_id)
    references public.tryouts (organization_id, id) on delete cascade,
  constraint tryout_divisions_name_not_blank check (char_length(trim(name)) between 1 and 120),
  constraint tryout_divisions_description_length check (description is null or char_length(description) <= 2000),
  constraint tryout_divisions_age_range check (min_age is null or max_age is null or min_age <= max_age),
  constraint tryout_divisions_age_nonnegative check ((min_age is null or min_age >= 0) and (max_age is null or max_age >= 0)),
  constraint tryout_divisions_sort_order_nonnegative check (sort_order >= 0),
  constraint tryout_divisions_order_key unique (organization_id, tryout_id, sort_order),
  constraint tryout_divisions_name_key unique (organization_id, tryout_id, name)
);

create index tryout_divisions_tryout_idx on public.tryout_divisions (organization_id, tryout_id, sort_order);

create trigger set_tryout_divisions_updated_at
before update on public.tryout_divisions
for each row
execute function public.set_updated_at();

create table public.tryout_positions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  tryout_id uuid not null,
  name text not null,
  code text,
  is_preset boolean not null default false,
  sort_order integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tryout_positions_organization_id_id_key unique (organization_id, id),
  constraint tryout_positions_organization_tryout_id_key unique (organization_id, tryout_id, id),
  constraint tryout_positions_tryout_fkey foreign key (organization_id, tryout_id)
    references public.tryouts (organization_id, id) on delete cascade,
  constraint tryout_positions_name_not_blank check (char_length(trim(name)) between 1 and 120),
  constraint tryout_positions_code_format check (code is null or code ~ '^[A-Z0-9_-]{1,24}$'),
  constraint tryout_positions_sort_order_nonnegative check (sort_order >= 0),
  constraint tryout_positions_order_key unique (organization_id, tryout_id, sort_order),
  constraint tryout_positions_name_key unique (organization_id, tryout_id, name)
);

create index tryout_positions_tryout_idx on public.tryout_positions (organization_id, tryout_id, sort_order);

create trigger set_tryout_positions_updated_at
before update on public.tryout_positions
for each row
execute function public.set_updated_at();

create table public.tryout_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  tryout_id uuid not null,
  division_id uuid not null,
  name text not null,
  location text,
  capacity integer,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tryout_sessions_organization_id_id_key unique (organization_id, id),
  constraint tryout_sessions_organization_tryout_id_key unique (organization_id, tryout_id, id),
  constraint tryout_sessions_division_fkey foreign key (organization_id, tryout_id, division_id)
    references public.tryout_divisions (organization_id, tryout_id, id) on delete restrict,
  constraint tryout_sessions_name_not_blank check (char_length(trim(name)) between 1 and 160),
  constraint tryout_sessions_location_length check (location is null or char_length(trim(location)) between 1 and 300),
  constraint tryout_sessions_capacity_positive check (capacity is null or capacity > 0),
  constraint tryout_sessions_time_range check (ends_at > starts_at),
  constraint tryout_sessions_sort_order_nonnegative check (sort_order >= 0),
  constraint tryout_sessions_order_key unique (organization_id, tryout_id, division_id, sort_order)
);

create index tryout_sessions_tryout_time_idx on public.tryout_sessions (organization_id, tryout_id, starts_at);
create index tryout_sessions_division_time_idx on public.tryout_sessions (organization_id, tryout_id, division_id, starts_at);

create trigger set_tryout_sessions_updated_at
before update on public.tryout_sessions
for each row
execute function public.set_updated_at();

create table public.session_groups (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  tryout_id uuid not null,
  session_id uuid not null,
  name text not null,
  sort_order integer not null,
  capacity integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint session_groups_organization_id_id_key unique (organization_id, id),
  constraint session_groups_organization_tryout_session_id_key unique (organization_id, tryout_id, session_id, id),
  constraint session_groups_session_fkey foreign key (organization_id, tryout_id, session_id)
    references public.tryout_sessions (organization_id, tryout_id, id) on delete cascade,
  constraint session_groups_name_not_blank check (char_length(trim(name)) between 1 and 120),
  constraint session_groups_sort_order_nonnegative check (sort_order >= 0),
  constraint session_groups_capacity_positive check (capacity is null or capacity > 0),
  constraint session_groups_order_key unique (organization_id, tryout_id, session_id, sort_order),
  constraint session_groups_name_key unique (organization_id, tryout_id, session_id, name)
);

create index session_groups_session_idx on public.session_groups (organization_id, tryout_id, session_id, sort_order);

create trigger set_session_groups_updated_at
before update on public.session_groups
for each row
execute function public.set_updated_at();

alter table public.tryout_staff_assignments
  add constraint tryout_staff_assignments_tryout_fkey foreign key (organization_id, tryout_id)
    references public.tryouts (organization_id, id) on delete cascade,
  add constraint tryout_staff_assignments_division_fkey foreign key (organization_id, tryout_id, division_id)
    references public.tryout_divisions (organization_id, tryout_id, id) on delete cascade,
  add constraint tryout_staff_assignments_session_fkey foreign key (organization_id, tryout_id, session_id)
    references public.tryout_sessions (organization_id, tryout_id, id) on delete cascade,
  add constraint tryout_staff_assignments_group_fkey foreign key (organization_id, tryout_id, session_id, group_id)
    references public.session_groups (organization_id, tryout_id, session_id, id) on delete cascade;

create function public.has_active_configuration_assignment(
  target_organization_id uuid,
  target_tryout_id uuid,
  target_division_id uuid default null,
  target_session_id uuid default null,
  target_group_id uuid default null,
  required_role text default null
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with target as (
    select
      coalesce(
        target_division_id,
        (
          select session.division_id
          from public.tryout_sessions as session
          where session.organization_id = target_organization_id
            and session.tryout_id = target_tryout_id
            and session.id = target_session_id
        ),
        (
          select session.division_id
          from public.session_groups as group_record
          join public.tryout_sessions as session
            on session.organization_id = group_record.organization_id
            and session.tryout_id = group_record.tryout_id
            and session.id = group_record.session_id
          where group_record.organization_id = target_organization_id
            and group_record.tryout_id = target_tryout_id
            and group_record.id = target_group_id
        )
      ) as division_id,
      coalesce(
        target_session_id,
        (
          select group_record.session_id
          from public.session_groups as group_record
          where group_record.organization_id = target_organization_id
            and group_record.tryout_id = target_tryout_id
            and group_record.id = target_group_id
        )
      ) as session_id
  )
  select public.is_active_organization_member(target_organization_id)
    and exists (
      select 1
      from public.tryout_staff_assignments as assignment
      cross join target
      where assignment.organization_id = target_organization_id
        and assignment.user_id = auth.uid()
        and assignment.tryout_id = target_tryout_id
        and (required_role is null or assignment.role = required_role)
        and assignment.revoked_at is null
        and (assignment.expires_at is null or assignment.expires_at > now())
        and (
          (target.division_id is null and target.session_id is null and target_group_id is null)
          or (assignment.division_id is null and assignment.session_id is null and assignment.group_id is null)
          or (assignment.division_id is not null and assignment.division_id = target.division_id)
          or (
            assignment.session_id is not null
            and (
              (target.session_id is not null and assignment.session_id = target.session_id)
              or (
                target.session_id is null
                and exists (
                  select 1
                  from public.tryout_sessions as assigned_session
                  where assigned_session.organization_id = target_organization_id
                    and assigned_session.tryout_id = target_tryout_id
                    and assigned_session.id = assignment.session_id
                    and assigned_session.division_id = target.division_id
                )
              )
            )
          )
          or (
            assignment.group_id is not null
            and (
              (target_group_id is not null and assignment.group_id = target_group_id)
              or (
                target_group_id is null
                and exists (
                  select 1
                  from public.session_groups as assigned_group
                  join public.tryout_sessions as assigned_session
                    on assigned_session.organization_id = assigned_group.organization_id
                    and assigned_session.tryout_id = assigned_group.tryout_id
                    and assigned_session.id = assigned_group.session_id
                  where assigned_group.organization_id = target_organization_id
                    and assigned_group.tryout_id = target_tryout_id
                    and assigned_group.id = assignment.group_id
                    and assigned_session.division_id = target.division_id
                    and (target.session_id is null or assigned_group.session_id = target.session_id)
                )
              )
            )
          )
        )
    );
$$;

create function public.can_read_tryout_configuration(
  target_organization_id uuid,
  target_tryout_id uuid,
  target_division_id uuid default null,
  target_session_id uuid default null,
  target_group_id uuid default null
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_active_organization_member(target_organization_id, array['owner', 'administrator'])
    or public.has_active_configuration_assignment(
      target_organization_id,
      target_tryout_id,
      target_division_id,
      target_session_id,
      target_group_id
    );
$$;

create function public.can_manage_tryout_configuration(
  target_organization_id uuid,
  target_tryout_id uuid,
  target_division_id uuid default null,
  target_session_id uuid default null,
  target_group_id uuid default null
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_active_organization_member(target_organization_id, array['owner', 'administrator'])
    or public.has_active_configuration_assignment(
      target_organization_id,
      target_tryout_id,
      target_division_id,
      target_session_id,
      target_group_id,
      'director'
    );
$$;

revoke all on function public.has_active_configuration_assignment(uuid, uuid, uuid, uuid, uuid, text) from public;
revoke all on function public.can_read_tryout_configuration(uuid, uuid, uuid, uuid, uuid) from public;
revoke all on function public.can_manage_tryout_configuration(uuid, uuid, uuid, uuid, uuid) from public;
grant execute on function public.has_active_configuration_assignment(uuid, uuid, uuid, uuid, uuid, text) to authenticated;
grant execute on function public.can_read_tryout_configuration(uuid, uuid, uuid, uuid, uuid) to authenticated;
grant execute on function public.can_manage_tryout_configuration(uuid, uuid, uuid, uuid, uuid) to authenticated;

alter table public.seasons enable row level security;
alter table public.tryouts enable row level security;
alter table public.tryout_divisions enable row level security;
alter table public.tryout_positions enable row level security;
alter table public.tryout_sessions enable row level security;
alter table public.session_groups enable row level security;

create policy seasons_select_active_member on public.seasons
for select to authenticated
using (public.is_active_organization_member(organization_id));

create policy seasons_manage_administrator on public.seasons
for all to authenticated
using (public.is_active_organization_member(organization_id, array['owner', 'administrator']))
with check (public.is_active_organization_member(organization_id, array['owner', 'administrator']));

create policy tryouts_select_authorized on public.tryouts
for select to authenticated
using (public.can_read_tryout_configuration(organization_id, id));

create policy tryouts_insert_administrator on public.tryouts
for insert to authenticated
with check (public.is_active_organization_member(organization_id, array['owner', 'administrator']));

create policy tryouts_update_director_or_administrator on public.tryouts
for update to authenticated
using (public.can_manage_tryout_configuration(organization_id, id))
with check (public.can_manage_tryout_configuration(organization_id, id));

create policy tryouts_delete_administrator on public.tryouts
for delete to authenticated
using (public.is_active_organization_member(organization_id, array['owner', 'administrator']));

create policy tryout_divisions_select_authorized on public.tryout_divisions
for select to authenticated
using (public.can_read_tryout_configuration(organization_id, tryout_id, id));

create policy tryout_divisions_manage_authorized on public.tryout_divisions
for all to authenticated
using (public.can_manage_tryout_configuration(organization_id, tryout_id, id))
with check (public.can_manage_tryout_configuration(organization_id, tryout_id, id));

create policy tryout_positions_select_authorized on public.tryout_positions
for select to authenticated
using (public.can_read_tryout_configuration(organization_id, tryout_id));

create policy tryout_positions_manage_authorized on public.tryout_positions
for all to authenticated
using (public.can_manage_tryout_configuration(organization_id, tryout_id))
with check (public.can_manage_tryout_configuration(organization_id, tryout_id));

create policy tryout_sessions_select_authorized on public.tryout_sessions
for select to authenticated
using (public.can_read_tryout_configuration(organization_id, tryout_id, division_id, id));

create policy tryout_sessions_manage_authorized on public.tryout_sessions
for all to authenticated
using (public.can_manage_tryout_configuration(organization_id, tryout_id, division_id, id))
with check (public.can_manage_tryout_configuration(organization_id, tryout_id, division_id, id));

create policy session_groups_select_authorized on public.session_groups
for select to authenticated
using (public.can_read_tryout_configuration(organization_id, tryout_id, null, session_id, id));

create policy session_groups_manage_authorized on public.session_groups
for all to authenticated
using (public.can_manage_tryout_configuration(organization_id, tryout_id, null, session_id, id))
with check (public.can_manage_tryout_configuration(organization_id, tryout_id, null, session_id, id));
