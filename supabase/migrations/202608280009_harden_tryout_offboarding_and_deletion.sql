create or replace function public.can_manage_tryout_root(target_organization_id uuid, target_tryout_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_active_organization_member(target_organization_id, array['owner', 'administrator'])
    or (
      public.is_active_organization_member(target_organization_id)
      and exists (
        select 1
        from public.tryout_staff_assignments as assignment
        where assignment.organization_id = target_organization_id
          and assignment.tryout_id = target_tryout_id
          and assignment.user_id = auth.uid()
          and assignment.role = 'director'
          and assignment.scope_kind = 'tryout'
          and assignment.revoked_at is null
          and (assignment.expires_at is null or assignment.expires_at > now())
      )
    );
$$;

create or replace function public.can_manage_tryout_division(target_organization_id uuid, target_tryout_id uuid, target_division_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.can_manage_tryout_root(target_organization_id, target_tryout_id)
    or (
      public.is_active_organization_member(target_organization_id)
      and exists (
        select 1
        from public.tryout_staff_assignments as assignment
        where assignment.organization_id = target_organization_id
          and assignment.tryout_id = target_tryout_id
          and assignment.user_id = auth.uid()
          and assignment.role = 'director'
          and assignment.scope_kind = 'division'
          and assignment.division_id = target_division_id
          and assignment.revoked_at is null
          and (assignment.expires_at is null or assignment.expires_at > now())
      )
    );
$$;

create or replace function public.can_manage_tryout_session(target_organization_id uuid, target_tryout_id uuid, target_division_id uuid, target_session_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.can_manage_tryout_division(target_organization_id, target_tryout_id, target_division_id)
    or (
      public.is_active_organization_member(target_organization_id)
      and exists (
        select 1
        from public.tryout_staff_assignments as assignment
        where assignment.organization_id = target_organization_id
          and assignment.tryout_id = target_tryout_id
          and assignment.user_id = auth.uid()
          and assignment.role = 'director'
          and assignment.scope_kind = 'session'
          and assignment.session_id = target_session_id
          and assignment.revoked_at is null
          and (assignment.expires_at is null or assignment.expires_at > now())
      )
    );
$$;

create or replace function public.can_manage_session_group(target_organization_id uuid, target_tryout_id uuid, target_session_id uuid, target_group_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.can_manage_tryout_session(
      target_organization_id,
      target_tryout_id,
      (
        select division_id
        from public.tryout_sessions
        where organization_id = target_organization_id
          and tryout_id = target_tryout_id
          and id = target_session_id
      ),
      target_session_id
    )
    or (
      public.is_active_organization_member(target_organization_id)
      and exists (
        select 1
        from public.tryout_staff_assignments as assignment
        where assignment.organization_id = target_organization_id
          and assignment.tryout_id = target_tryout_id
          and assignment.user_id = auth.uid()
          and assignment.role = 'director'
          and assignment.scope_kind = 'group'
          and assignment.session_id = target_session_id
          and assignment.group_id = target_group_id
          and assignment.revoked_at is null
          and (assignment.expires_at is null or assignment.expires_at > now())
      )
    );
$$;

drop policy tryouts_delete_administrator on public.tryouts;

create policy tryouts_delete_draft_administrator on public.tryouts
for delete to authenticated
using (
  status = 'draft'
  and public.is_active_organization_member(organization_id, array['owner', 'administrator'])
);

alter table public.tryouts
  add constraint tryouts_version_capacity check (version <= 1000000000);

create or replace function public.increment_tryout_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.version >= 1000000000 then
    raise exception 'tryout version capacity reached' using errcode = '23514';
  end if;

  new.version := old.version + 1;
  return new;
end;
$$;

create or replace function public.transition_tryout_lifecycle(p_organization_id uuid, p_tryout_id uuid, p_expected_version integer, p_action text)
returns table (outcome text, tryout_id uuid, organization_id uuid, season_id uuid, name text, slug text, sport text, timezone text, status text, registration_starts_at timestamptz, registration_ends_at timestamptz, published_at timestamptz, finalized_at timestamptz, version integer, created_at timestamptz, updated_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  current_tryout public.tryouts%rowtype;
  updated_tryout public.tryouts%rowtype;
begin
  if not public.can_manage_tryout_root(p_organization_id, p_tryout_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select target.* into current_tryout
  from public.tryouts as target
  where target.organization_id = p_organization_id and target.id = p_tryout_id
  for update;

  if not found then
    return query select 'not_found'::text, null::uuid, null::uuid, null::uuid, null::text, null::text, null::text, null::text, null::text, null::timestamptz, null::timestamptz, null::timestamptz, null::timestamptz, null::integer, null::timestamptz, null::timestamptz;
    return;
  end if;

  if current_tryout.version <> p_expected_version or current_tryout.version >= 1000000000 then
    return query select 'conflict'::text, current_tryout.id, current_tryout.organization_id, current_tryout.season_id, current_tryout.name, current_tryout.slug, current_tryout.sport, current_tryout.timezone, current_tryout.status, current_tryout.registration_starts_at, current_tryout.registration_ends_at, current_tryout.published_at, current_tryout.finalized_at, current_tryout.version, current_tryout.created_at, current_tryout.updated_at;
    return;
  end if;

  if current_tryout.status = 'draft' and p_action = 'publish' then
    update public.tryouts as target
    set status = 'published', published_at = clock_timestamp()
    where target.id = current_tryout.id
      and target.organization_id = current_tryout.organization_id
      and target.version = p_expected_version
    returning target.* into updated_tryout;
  elsif current_tryout.status = 'published' and p_action = 'finalize' then
    update public.tryouts as target
    set status = 'finalized', finalized_at = clock_timestamp()
    where target.id = current_tryout.id
      and target.organization_id = current_tryout.organization_id
      and target.version = p_expected_version
    returning target.* into updated_tryout;
  else
    return query select 'invalid_transition'::text, current_tryout.id, current_tryout.organization_id, current_tryout.season_id, current_tryout.name, current_tryout.slug, current_tryout.sport, current_tryout.timezone, current_tryout.status, current_tryout.registration_starts_at, current_tryout.registration_ends_at, current_tryout.published_at, current_tryout.finalized_at, current_tryout.version, current_tryout.created_at, current_tryout.updated_at;
    return;
  end if;

  if not found then
    return query select 'conflict'::text, current_tryout.id, current_tryout.organization_id, current_tryout.season_id, current_tryout.name, current_tryout.slug, current_tryout.sport, current_tryout.timezone, current_tryout.status, current_tryout.registration_starts_at, current_tryout.registration_ends_at, current_tryout.published_at, current_tryout.finalized_at, current_tryout.version, current_tryout.created_at, current_tryout.updated_at;
    return;
  end if;

  return query select 'updated'::text, updated_tryout.id, updated_tryout.organization_id, updated_tryout.season_id, updated_tryout.name, updated_tryout.slug, updated_tryout.sport, updated_tryout.timezone, updated_tryout.status, updated_tryout.registration_starts_at, updated_tryout.registration_ends_at, updated_tryout.published_at, updated_tryout.finalized_at, updated_tryout.version, updated_tryout.created_at, updated_tryout.updated_at;
end;
$$;
