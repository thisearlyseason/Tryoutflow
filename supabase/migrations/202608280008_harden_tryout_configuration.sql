alter table public.tryouts
  add column version integer not null default 0,
  add constraint tryouts_version_nonnegative check (version >= 0);

create function public.prevent_tryout_boundary_or_lifecycle_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.organization_id is distinct from new.organization_id then
    raise exception 'tryout organization is immutable' using errcode = '23514';
  end if;

  if old.published_at is not null and new.published_at is distinct from old.published_at then
    raise exception 'published timestamp is immutable' using errcode = '23514';
  end if;

  if old.finalized_at is not null and new.finalized_at is distinct from old.finalized_at then
    raise exception 'finalized timestamp is immutable' using errcode = '23514';
  end if;

  if old.status = 'draft' and new.status = 'published' then
    if new.published_at is null or new.finalized_at is not null then
      raise exception 'published tryouts require one publication timestamp' using errcode = '23514';
    end if;
    return new;
  end if;

  if old.status = 'published' and new.status = 'finalized' then
    if new.published_at is distinct from old.published_at
      or new.finalized_at is null then
      raise exception 'finalized tryouts retain publication time and require finalization time' using errcode = '23514';
    end if;
    return new;
  end if;

  if old.status <> new.status then
    raise exception 'invalid tryout lifecycle transition' using errcode = '23514';
  end if;

  if old.status = 'draft' then
    if new.published_at is not null or new.finalized_at is not null then
      raise exception 'draft lifecycle timestamps must remain null' using errcode = '23514';
    end if;
    return new;
  end if;

  if (to_jsonb(new) - 'updated_at' - 'version') is distinct from (to_jsonb(old) - 'updated_at' - 'version') then
    raise exception 'published tryout configuration is immutable' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger prevent_tryout_lifecycle_regression on public.tryouts;

create trigger prevent_tryout_boundary_or_lifecycle_mutation
before update on public.tryouts
for each row
execute function public.prevent_tryout_boundary_or_lifecycle_mutation();

create function public.increment_tryout_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.version := old.version + 1;
  return new;
end;
$$;

create trigger a_increment_tryout_version
before update on public.tryouts
for each row
execute function public.increment_tryout_version();

create function public.prevent_published_configuration_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  target_organization_id uuid := coalesce(new.organization_id, old.organization_id);
  target_tryout_id uuid := coalesce(new.tryout_id, old.tryout_id);
  target_status text;
begin
  if tg_op = 'UPDATE' and (
    (to_jsonb(old) ->> 'id') is distinct from (to_jsonb(new) ->> 'id')
    or (to_jsonb(old) ->> 'organization_id') is distinct from (to_jsonb(new) ->> 'organization_id')
    or (to_jsonb(old) ->> 'tryout_id') is distinct from (to_jsonb(new) ->> 'tryout_id')
    or (to_jsonb(old) ->> 'division_id') is distinct from (to_jsonb(new) ->> 'division_id')
    or (to_jsonb(old) ->> 'session_id') is distinct from (to_jsonb(new) ->> 'session_id')
  ) then
    raise exception 'configuration tenant and tryout boundaries are immutable' using errcode = '23514';
  end if;

  select status into target_status
  from public.tryouts
  where organization_id = target_organization_id and id = target_tryout_id;

  if target_status in ('published', 'finalized') and pg_trigger_depth() = 1 then
    raise exception 'published tryout configuration is immutable' using errcode = '23514';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger prevent_tryout_division_published_mutation
before insert or update or delete on public.tryout_divisions
for each row execute function public.prevent_published_configuration_mutation();

create trigger prevent_tryout_position_published_mutation
before insert or update or delete on public.tryout_positions
for each row execute function public.prevent_published_configuration_mutation();

create trigger prevent_tryout_session_published_mutation
before insert or update or delete on public.tryout_sessions
for each row execute function public.prevent_published_configuration_mutation();

create trigger prevent_session_group_published_mutation
before insert or update or delete on public.session_groups
for each row execute function public.prevent_published_configuration_mutation();

create function public.prevent_staff_assignment_scope_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.organization_id is distinct from new.organization_id
    or old.tryout_id is distinct from new.tryout_id
    or old.division_id is distinct from new.division_id
    or old.session_id is distinct from new.session_id
    or old.group_id is distinct from new.group_id
    or old.athlete_id is distinct from new.athlete_id
    or old.scope_kind is distinct from new.scope_kind
    or old.role is distinct from new.role
    or old.user_id is distinct from new.user_id then
    raise exception 'staff assignment scope is immutable; revoke and create a replacement' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger prevent_staff_assignment_scope_mutation
before update on public.tryout_staff_assignments
for each row execute function public.prevent_staff_assignment_scope_mutation();

create or replace function public.has_active_configuration_assignment(
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
        and assignment.role <> 'reviewer'
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

create function public.can_manage_tryout_root(target_organization_id uuid, target_tryout_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_active_organization_member(target_organization_id, array['owner', 'administrator'])
    or exists (select 1 from public.tryout_staff_assignments as assignment where assignment.organization_id = target_organization_id and assignment.tryout_id = target_tryout_id and assignment.user_id = auth.uid() and assignment.role = 'director' and assignment.scope_kind = 'tryout' and assignment.revoked_at is null and (assignment.expires_at is null or assignment.expires_at > now()));
$$;

create function public.can_manage_tryout_division(target_organization_id uuid, target_tryout_id uuid, target_division_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.can_manage_tryout_root(target_organization_id, target_tryout_id)
    or exists (select 1 from public.tryout_staff_assignments as assignment where assignment.organization_id = target_organization_id and assignment.tryout_id = target_tryout_id and assignment.user_id = auth.uid() and assignment.role = 'director' and assignment.scope_kind = 'division' and assignment.division_id = target_division_id and assignment.revoked_at is null and (assignment.expires_at is null or assignment.expires_at > now()));
$$;

create function public.can_manage_tryout_session(target_organization_id uuid, target_tryout_id uuid, target_division_id uuid, target_session_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.can_manage_tryout_division(target_organization_id, target_tryout_id, target_division_id)
    or exists (select 1 from public.tryout_staff_assignments as assignment where assignment.organization_id = target_organization_id and assignment.tryout_id = target_tryout_id and assignment.user_id = auth.uid() and assignment.role = 'director' and assignment.scope_kind = 'session' and assignment.session_id = target_session_id and assignment.revoked_at is null and (assignment.expires_at is null or assignment.expires_at > now()));
$$;

create function public.can_manage_session_group(target_organization_id uuid, target_tryout_id uuid, target_session_id uuid, target_group_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.can_manage_tryout_session(target_organization_id, target_tryout_id, (select division_id from public.tryout_sessions where organization_id = target_organization_id and tryout_id = target_tryout_id and id = target_session_id), target_session_id)
    or exists (select 1 from public.tryout_staff_assignments as assignment where assignment.organization_id = target_organization_id and assignment.tryout_id = target_tryout_id and assignment.user_id = auth.uid() and assignment.role = 'director' and assignment.scope_kind = 'group' and assignment.session_id = target_session_id and assignment.group_id = target_group_id and assignment.revoked_at is null and (assignment.expires_at is null or assignment.expires_at > now()));
$$;

revoke all on function public.can_manage_tryout_root(uuid, uuid) from public;
revoke all on function public.can_manage_tryout_division(uuid, uuid, uuid) from public;
revoke all on function public.can_manage_tryout_session(uuid, uuid, uuid, uuid) from public;
revoke all on function public.can_manage_session_group(uuid, uuid, uuid, uuid) from public;
grant execute on function public.can_manage_tryout_root(uuid, uuid) to authenticated;
grant execute on function public.can_manage_tryout_division(uuid, uuid, uuid) to authenticated;
grant execute on function public.can_manage_tryout_session(uuid, uuid, uuid, uuid) to authenticated;
grant execute on function public.can_manage_session_group(uuid, uuid, uuid, uuid) to authenticated;

drop policy tryouts_update_director_or_administrator on public.tryouts;
drop policy tryout_divisions_manage_authorized on public.tryout_divisions;
drop policy tryout_positions_manage_authorized on public.tryout_positions;
drop policy tryout_sessions_manage_authorized on public.tryout_sessions;
drop policy session_groups_manage_authorized on public.session_groups;

create policy tryouts_update_draft_configuration on public.tryouts
for update to authenticated
using (status = 'draft' and public.can_manage_tryout_root(organization_id, id))
with check (status = 'draft' and public.can_manage_tryout_root(organization_id, id));

create policy tryout_divisions_manage_exact_scope on public.tryout_divisions
for all to authenticated using (public.can_manage_tryout_division(organization_id, tryout_id, id)) with check (public.can_manage_tryout_division(organization_id, tryout_id, id));

create policy tryout_positions_manage_tryout_scope on public.tryout_positions
for all to authenticated using (public.can_manage_tryout_root(organization_id, tryout_id)) with check (public.can_manage_tryout_root(organization_id, tryout_id));

create policy tryout_sessions_manage_exact_scope on public.tryout_sessions
for all to authenticated using (public.can_manage_tryout_session(organization_id, tryout_id, division_id, id)) with check (public.can_manage_tryout_session(organization_id, tryout_id, division_id, id));

create policy session_groups_manage_exact_scope on public.session_groups
for all to authenticated using (public.can_manage_session_group(organization_id, tryout_id, session_id, id)) with check (public.can_manage_session_group(organization_id, tryout_id, session_id, id));

create function public.create_tryout_draft(
  p_organization_id uuid,
  p_season_id uuid,
  p_name text,
  p_slug text,
  p_sport text,
  p_timezone text,
  p_registration_starts_at timestamptz,
  p_registration_ends_at timestamptz
)
returns table (tryout_id uuid, organization_id uuid, season_id uuid, name text, slug text, sport text, timezone text, status text, registration_starts_at timestamptz, registration_ends_at timestamptz, published_at timestamptz, finalized_at timestamptz, version integer, created_at timestamptz, updated_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare created_tryout public.tryouts%rowtype;
begin
  if not public.is_active_organization_member(p_organization_id, array['owner', 'administrator']) then raise exception 'forbidden' using errcode = '42501'; end if;
  insert into public.tryouts (organization_id, season_id, name, slug, sport, timezone, registration_starts_at, registration_ends_at)
  values (p_organization_id, p_season_id, trim(p_name), p_slug, trim(p_sport), p_timezone, p_registration_starts_at, p_registration_ends_at)
  returning * into created_tryout;
  return query select created_tryout.id, created_tryout.organization_id, created_tryout.season_id, created_tryout.name, created_tryout.slug, created_tryout.sport, created_tryout.timezone, created_tryout.status, created_tryout.registration_starts_at, created_tryout.registration_ends_at, created_tryout.published_at, created_tryout.finalized_at, created_tryout.version, created_tryout.created_at, created_tryout.updated_at;
end;
$$;

create function public.transition_tryout_lifecycle(p_organization_id uuid, p_tryout_id uuid, p_expected_version integer, p_action text)
returns table (outcome text, tryout_id uuid, organization_id uuid, season_id uuid, name text, slug text, sport text, timezone text, status text, registration_starts_at timestamptz, registration_ends_at timestamptz, published_at timestamptz, finalized_at timestamptz, version integer, created_at timestamptz, updated_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare current_tryout public.tryouts%rowtype; updated_tryout public.tryouts%rowtype;
begin
  if not public.can_manage_tryout_root(p_organization_id, p_tryout_id) then raise exception 'forbidden' using errcode = '42501'; end if;
  select target.* into current_tryout
  from public.tryouts as target
  where target.organization_id = p_organization_id and target.id = p_tryout_id
  for update;
  if not found then return query select 'not_found'::text, null::uuid, null::uuid, null::uuid, null::text, null::text, null::text, null::text, null::text, null::timestamptz, null::timestamptz, null::timestamptz, null::timestamptz, null::integer, null::timestamptz, null::timestamptz; return; end if;
  if current_tryout.version <> p_expected_version then return query select 'conflict'::text, current_tryout.id, current_tryout.organization_id, current_tryout.season_id, current_tryout.name, current_tryout.slug, current_tryout.sport, current_tryout.timezone, current_tryout.status, current_tryout.registration_starts_at, current_tryout.registration_ends_at, current_tryout.published_at, current_tryout.finalized_at, current_tryout.version, current_tryout.created_at, current_tryout.updated_at; return; end if;
  if (current_tryout.status = 'draft' and p_action = 'publish') then
    update public.tryouts as target set status = 'published', published_at = clock_timestamp()
    where target.id = current_tryout.id and target.organization_id = current_tryout.organization_id and target.version = p_expected_version
    returning target.* into updated_tryout;
  elsif (current_tryout.status = 'published' and p_action = 'finalize') then
    update public.tryouts as target set status = 'finalized', finalized_at = clock_timestamp()
    where target.id = current_tryout.id and target.organization_id = current_tryout.organization_id and target.version = p_expected_version
    returning target.* into updated_tryout;
  else return query select 'invalid_transition'::text, current_tryout.id, current_tryout.organization_id, current_tryout.season_id, current_tryout.name, current_tryout.slug, current_tryout.sport, current_tryout.timezone, current_tryout.status, current_tryout.registration_starts_at, current_tryout.registration_ends_at, current_tryout.published_at, current_tryout.finalized_at, current_tryout.version, current_tryout.created_at, current_tryout.updated_at; return;
  end if;
  if not found then return query select 'conflict'::text, current_tryout.id, current_tryout.organization_id, current_tryout.season_id, current_tryout.name, current_tryout.slug, current_tryout.sport, current_tryout.timezone, current_tryout.status, current_tryout.registration_starts_at, current_tryout.registration_ends_at, current_tryout.published_at, current_tryout.finalized_at, current_tryout.version, current_tryout.created_at, current_tryout.updated_at; return; end if;
  return query select 'updated'::text, updated_tryout.id, updated_tryout.organization_id, updated_tryout.season_id, updated_tryout.name, updated_tryout.slug, updated_tryout.sport, updated_tryout.timezone, updated_tryout.status, updated_tryout.registration_starts_at, updated_tryout.registration_ends_at, updated_tryout.published_at, updated_tryout.finalized_at, updated_tryout.version, updated_tryout.created_at, updated_tryout.updated_at;
end;
$$;

revoke all on function public.create_tryout_draft(uuid, uuid, text, text, text, text, timestamptz, timestamptz) from public;
revoke all on function public.transition_tryout_lifecycle(uuid, uuid, integer, text) from public;
grant execute on function public.create_tryout_draft(uuid, uuid, text, text, text, text, timestamptz, timestamptz) to authenticated;
grant execute on function public.transition_tryout_lifecycle(uuid, uuid, integer, text) to authenticated;
