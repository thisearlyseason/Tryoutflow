create table public.organization_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'member',
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organization_members_organization_id_id_key unique (organization_id, id),
  constraint organization_members_organization_id_user_id_key unique (organization_id, user_id),
  constraint organization_members_role check (role in ('owner', 'administrator', 'member')),
  constraint organization_members_status check (status in ('active', 'disabled'))
);

create index organization_members_user_organization_active_idx
on public.organization_members (user_id, organization_id)
where status = 'active';

create trigger set_organization_members_updated_at
before update on public.organization_members
for each row
execute function public.set_updated_at();

create function public.prevent_last_active_owner_removal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.role <> 'owner' or old.status <> 'active' then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE'
    and new.role = 'owner'
    and new.status = 'active'
    and new.organization_id = old.organization_id
    and new.user_id = old.user_id then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(old.organization_id::text, 0));

  if not exists (
    select 1
    from public.organization_members as membership
    where membership.organization_id = old.organization_id
      and membership.id <> old.id
      and membership.role = 'owner'
      and membership.status = 'active'
  ) then
    raise exception 'organizations must retain an active owner' using errcode = '23514';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger prevent_last_active_owner_removal
before update or delete on public.organization_members
for each row
execute function public.prevent_last_active_owner_removal();

create table public.organization_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  email extensions.citext not null,
  role text not null default 'member',
  token_digest text not null,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by_user_id uuid references auth.users (id) on delete set null,
  revoked_at timestamptz,
  created_by_user_id uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organization_invitations_organization_id_id_key unique (organization_id, id),
  constraint organization_invitations_token_digest_key unique (token_digest),
  constraint organization_invitations_role check (role in ('administrator', 'member')),
  constraint organization_invitations_email_not_blank check (char_length(trim(email::text)) > 0),
  constraint organization_invitations_expiry_after_creation check (expires_at > created_at),
  constraint organization_invitations_acceptance_consistency check (
    (accepted_at is null and accepted_by_user_id is null) or (accepted_at is not null and accepted_by_user_id is not null)
  )
);

create index organization_invitations_active_email_idx
on public.organization_invitations (organization_id, email, expires_at)
where accepted_at is null and revoked_at is null;

create trigger set_organization_invitations_updated_at
before update on public.organization_invitations
for each row
execute function public.set_updated_at();

create table public.tryout_staff_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null,
  scope_kind text not null,
  tryout_id uuid not null,
  division_id uuid,
  session_id uuid,
  group_id uuid,
  athlete_id uuid,
  expires_at timestamptz,
  revoked_at timestamptz,
  granted_by_user_id uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tryout_staff_assignments_organization_id_id_key unique (organization_id, id),
  constraint tryout_staff_assignments_role check (role in ('director', 'evaluator', 'checkin', 'reviewer')),
  constraint tryout_staff_assignments_scope_kind check (scope_kind in ('tryout', 'division', 'session', 'group', 'athlete')),
  constraint tryout_staff_assignments_valid_scope check (
    (scope_kind = 'tryout' and division_id is null and session_id is null and group_id is null and athlete_id is null)
    or (scope_kind = 'division' and division_id is not null and session_id is null and group_id is null and athlete_id is null)
    or (scope_kind = 'session' and division_id is null and session_id is not null and group_id is null and athlete_id is null)
    or (scope_kind = 'group' and division_id is null and session_id is not null and group_id is not null and athlete_id is null)
    or (scope_kind = 'athlete' and division_id is null and session_id is null and group_id is null and athlete_id is not null)
  ),
  constraint tryout_staff_assignments_expiry_after_creation check (expires_at is null or expires_at > created_at)
);

create unique index tryout_staff_assignments_active_scope_key
on public.tryout_staff_assignments (
  organization_id,
  user_id,
  role,
  tryout_id,
  division_id,
  session_id,
  group_id,
  athlete_id
) nulls not distinct
where revoked_at is null;

create index tryout_staff_assignments_active_user_scope_idx
on public.tryout_staff_assignments (user_id, organization_id, role, tryout_id, division_id, session_id)
where revoked_at is null;

create trigger set_tryout_staff_assignments_updated_at
before update on public.tryout_staff_assignments
for each row
execute function public.set_updated_at();

create table public.platform_support_elevations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  support_user_id uuid not null references auth.users (id) on delete restrict,
  granted_by_user_id uuid not null references auth.users (id) on delete restrict,
  audit_log_id uuid not null,
  reason text not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint platform_support_elevations_organization_id_id_key unique (organization_id, id),
  constraint platform_support_elevations_audit_log_fkey foreign key (organization_id, audit_log_id)
    references public.audit_logs (organization_id, id) on delete restrict,
  constraint platform_support_elevations_reason_not_blank check (char_length(trim(reason)) between 10 and 2000),
  constraint platform_support_elevations_expiry_after_creation check (expires_at > created_at)
);

create unique index platform_support_elevations_one_active_access_key
on public.platform_support_elevations (organization_id, support_user_id)
where revoked_at is null;

create index platform_support_elevations_active_lookup_idx
on public.platform_support_elevations (support_user_id, organization_id, expires_at)
where revoked_at is null;

create function public.is_active_organization_member(
  target_organization_id uuid,
  allowed_roles text[] default null
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_members as membership
    where membership.organization_id = target_organization_id
      and membership.user_id = auth.uid()
      and membership.status = 'active'
      and (allowed_roles is null or membership.role = any (allowed_roles))
  );
$$;

create function public.can_read_tenant_record(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_active_organization_member(target_organization_id);
$$;

create function public.has_active_staff_assignment(
  target_organization_id uuid,
  required_role text,
  target_tryout_id uuid,
  target_division_id uuid default null,
  target_session_id uuid default null,
  target_group_id uuid default null,
  target_athlete_id uuid default null
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_active_organization_member(target_organization_id)
    and exists (
      select 1
      from public.tryout_staff_assignments as assignment
      where assignment.organization_id = target_organization_id
        and assignment.user_id = auth.uid()
        and assignment.role = required_role
        and assignment.tryout_id = target_tryout_id
        and (assignment.division_id is null or assignment.division_id = target_division_id)
        and (assignment.session_id is null or assignment.session_id = target_session_id)
        and (assignment.group_id is null or assignment.group_id = target_group_id)
        and (assignment.athlete_id is null or assignment.athlete_id = target_athlete_id)
        and assignment.revoked_at is null
        and (assignment.expires_at is null or assignment.expires_at > now())
    );
$$;

create function public.can_access_evaluation(
  target_organization_id uuid,
  target_tryout_id uuid,
  target_division_id uuid,
  target_session_id uuid,
  evaluator_user_id uuid,
  is_mutation boolean
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    public.is_active_organization_member(target_organization_id, array['owner', 'administrator'])
    or (
      evaluator_user_id = auth.uid()
      and public.has_active_staff_assignment(
        target_organization_id,
        'evaluator',
        target_tryout_id,
        target_division_id,
        target_session_id
      )
    );
$$;

create function public.has_active_platform_support_elevation(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.platform_support_elevations as elevation
    where elevation.organization_id = target_organization_id
      and elevation.support_user_id = auth.uid()
      and elevation.revoked_at is null
      and elevation.expires_at > now()
  );
$$;

revoke all on function public.is_active_organization_member(uuid, text[]) from public;
revoke all on function public.has_active_staff_assignment(uuid, text, uuid, uuid, uuid, uuid, uuid) from public;
revoke all on function public.has_active_platform_support_elevation(uuid) from public;
grant execute on function public.is_active_organization_member(uuid, text[]) to authenticated;
grant execute on function public.has_active_staff_assignment(uuid, text, uuid, uuid, uuid, uuid, uuid) to authenticated;
grant execute on function public.can_read_tenant_record(uuid) to anon, authenticated;
grant execute on function public.can_access_evaluation(uuid, uuid, uuid, uuid, uuid, boolean) to anon, authenticated;

alter table public.organization_members enable row level security;
alter table public.organization_invitations enable row level security;
alter table public.tryout_staff_assignments enable row level security;
alter table public.platform_support_elevations enable row level security;

create policy profiles_select_self on public.profiles
for select to authenticated
using (id = auth.uid());

create policy profiles_update_self on public.profiles
for update to authenticated
using (id = auth.uid())
with check (id = auth.uid());

create policy organizations_select_member on public.organizations
for select to authenticated
using (public.can_read_tenant_record(id));

create policy organizations_update_administrator on public.organizations
for update to authenticated
using (public.is_active_organization_member(id, array['owner', 'administrator']))
with check (public.is_active_organization_member(id, array['owner', 'administrator']));

create policy audit_logs_select_administrator on public.audit_logs
for select to authenticated
using (public.is_active_organization_member(organization_id, array['owner', 'administrator']));

create policy organization_members_select_self_or_administrator on public.organization_members
for select to authenticated
using (
  user_id = auth.uid()
  or public.is_active_organization_member(organization_id, array['owner', 'administrator'])
);

create policy organization_members_manage_owner on public.organization_members
for all to authenticated
using (public.is_active_organization_member(organization_id, array['owner']))
with check (public.is_active_organization_member(organization_id, array['owner']));

create policy organization_members_manage_nonowner_administrator on public.organization_members
for all to authenticated
using (
  role <> 'owner'
  and public.is_active_organization_member(organization_id, array['administrator'])
)
with check (
  role <> 'owner'
  and public.is_active_organization_member(organization_id, array['administrator'])
);

create policy organization_invitations_manage_administrator on public.organization_invitations
for all to authenticated
using (public.is_active_organization_member(organization_id, array['owner', 'administrator']))
with check (public.is_active_organization_member(organization_id, array['owner', 'administrator']));

create policy tryout_staff_assignments_select_self_or_administrator on public.tryout_staff_assignments
for select to authenticated
using (
  user_id = auth.uid()
  or public.is_active_organization_member(organization_id, array['owner', 'administrator'])
);

create policy tryout_staff_assignments_manage_administrator on public.tryout_staff_assignments
for all to authenticated
using (public.is_active_organization_member(organization_id, array['owner', 'administrator']))
with check (public.is_active_organization_member(organization_id, array['owner', 'administrator']));
