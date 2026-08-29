-- Serialize evaluator grants with membership and principal deletion, revoke every
-- stale grant boundary, expose exact evaluation contexts, and reduce ACLs to the
-- authenticated RLS read plus narrowly granted RPCs.

create function public.revoke_orphaned_staff_assignments()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  revoked_count bigint;
begin
  update public.tryout_staff_assignments as assignment
  set revoked_at = clock_timestamp()
  where assignment.revoked_at is null
    and not exists (
      select 1
      from public.organization_members as membership
      where membership.organization_id = assignment.organization_id
        and membership.user_id = assignment.user_id
        and membership.status = 'active'
    );
  get diagnostics revoked_count = row_count;
  return revoked_count;
end;
$$;

select public.revoke_orphaned_staff_assignments();

drop trigger revoke_staff_assignments_on_offboarding on public.organization_members;

create or replace function public.revoke_staff_assignments_on_offboarding()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    update public.tryout_staff_assignments
    set revoked_at = clock_timestamp()
    where organization_id = old.organization_id
      and user_id = old.user_id
      and revoked_at is null;
    return old;
  end if;

  if old.organization_id is distinct from new.organization_id
    or old.user_id is distinct from new.user_id then
    update public.tryout_staff_assignments
    set revoked_at = clock_timestamp()
    where organization_id = old.organization_id
      and user_id = old.user_id
      and revoked_at is null;

    -- A changed membership identity is never allowed to inherit a grant that was
    -- already drifting at the destination boundary.
    update public.tryout_staff_assignments
    set revoked_at = clock_timestamp()
    where organization_id = new.organization_id
      and user_id = new.user_id
      and revoked_at is null;
  elsif old.status = 'active' and new.status <> 'active' then
    update public.tryout_staff_assignments
    set revoked_at = clock_timestamp()
    where organization_id = new.organization_id
      and user_id = new.user_id
      and revoked_at is null;
  end if;
  return new;
end;
$$;

create trigger revoke_staff_assignments_on_offboarding
after update or delete on public.organization_members
for each row execute function public.revoke_staff_assignments_on_offboarding();

create or replace function public.assign_evaluator(
  p_organization_id uuid,
  p_evaluator_user_id uuid,
  p_tryout_id uuid,
  p_scope_kind text,
  p_division_id uuid default null,
  p_session_id uuid default null,
  p_group_id uuid default null,
  p_expires_at timestamptz default null
) returns table(outcome text, assignment_id uuid)
language plpgsql security definer set search_path = '' as $$
declare
  created_assignment_id uuid;
  evaluator_membership_id uuid;
begin
  if auth.uid() is null then return query select 'forbidden'::text,null::uuid; return; end if;
  if p_expires_at is not null and p_expires_at<=clock_timestamp() then
    return query select 'invalid_scope'::text,null::uuid; return;
  end if;
  if not public.is_active_organization_member(p_organization_id,array['owner','administrator'])
    and not exists(
      select 1 from public.tryout_staff_assignments a
      where a.organization_id=p_organization_id and a.user_id=auth.uid() and a.role='director'
        and a.tryout_id=p_tryout_id and a.revoked_at is null
        and (a.expires_at is null or a.expires_at>clock_timestamp())
    )
  then return query select 'forbidden'::text,null::uuid; return; end if;
  if not public.can_manage_evaluator_scope(p_organization_id,p_tryout_id,p_scope_kind,p_division_id,p_session_id,p_group_id) then
    if (p_scope_kind='tryout' and (p_division_id is not null or p_session_id is not null or p_group_id is not null))
      or (p_scope_kind='division' and (p_division_id is null or p_session_id is not null or p_group_id is not null))
      or (p_scope_kind='session' and (p_division_id is not null or p_session_id is null or p_group_id is not null))
      or (p_scope_kind='group' and (p_division_id is not null or p_session_id is null or p_group_id is null))
      or p_scope_kind not in ('tryout','division','session','group')
      or (p_scope_kind='division' and not exists(select 1 from public.tryout_divisions d where d.organization_id=p_organization_id and d.tryout_id=p_tryout_id and d.id=p_division_id))
      or (p_scope_kind in ('session','group') and not exists(select 1 from public.tryout_sessions s where s.organization_id=p_organization_id and s.tryout_id=p_tryout_id and s.id=p_session_id))
      or (p_scope_kind='group' and not exists(select 1 from public.session_groups g where g.organization_id=p_organization_id and g.tryout_id=p_tryout_id and g.session_id=p_session_id and g.id=p_group_id))
    then return query select 'invalid_scope'::text,null::uuid; return;
    end if;
    return query select 'forbidden'::text,null::uuid; return;
  end if;

  -- Principal and tenant rows precede membership and assignment locks. This matches
  -- FK cascade order and prevents an auth-user or organization deletion from
  -- forming a principal -> membership / membership -> principal deadlock cycle.
  perform 1 from public.organizations where id=p_organization_id for key share;
  perform 1 from auth.users where id=p_evaluator_user_id for key share;
  select m.id into evaluator_membership_id
  from public.organization_members m
  where m.organization_id=p_organization_id
    and m.user_id=p_evaluator_user_id
    and m.status='active'
  for update;
  if not found then return query select 'not_member'::text,null::uuid; return; end if;

  perform pg_advisory_xact_lock(hashtextextended(concat_ws(':','evaluator-assignment',p_organization_id,p_evaluator_user_id,p_tryout_id,p_scope_kind,p_division_id,p_session_id,p_group_id),0));
  update public.tryout_staff_assignments a set revoked_at=clock_timestamp()
  where a.organization_id=p_organization_id and a.user_id=p_evaluator_user_id and a.role='evaluator'
    and a.tryout_id=p_tryout_id and a.scope_kind=p_scope_kind
    and a.division_id is not distinct from p_division_id and a.session_id is not distinct from p_session_id
    and a.group_id is not distinct from p_group_id and a.athlete_id is null
    and a.revoked_at is null and a.expires_at is not null and a.expires_at<=clock_timestamp();
  if exists(
    select 1 from public.tryout_staff_assignments a
    where a.organization_id=p_organization_id and a.user_id=p_evaluator_user_id and a.role='evaluator'
      and a.tryout_id=p_tryout_id and a.scope_kind=p_scope_kind
      and a.division_id is not distinct from p_division_id and a.session_id is not distinct from p_session_id
      and a.group_id is not distinct from p_group_id and a.athlete_id is null and a.revoked_at is null
  ) then return query select 'duplicate'::text,null::uuid; return; end if;

  insert into public.tryout_staff_assignments(
    organization_id,user_id,role,scope_kind,tryout_id,division_id,session_id,group_id,expires_at,granted_by_user_id
  ) values(
    p_organization_id,p_evaluator_user_id,'evaluator',p_scope_kind,p_tryout_id,p_division_id,p_session_id,p_group_id,p_expires_at,auth.uid()
  ) returning id into created_assignment_id;
  insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,details)
  values(p_organization_id,auth.uid(),'staffing.evaluator_assigned','tryout_staff_assignment',created_assignment_id,
    jsonb_build_object('tryoutId',p_tryout_id,'scopeKind',p_scope_kind));
  return query select 'assigned'::text,created_assignment_id;
end;
$$;

drop function public.list_assigned_athletes(uuid,uuid);
create function public.list_assigned_athletes(p_organization_id uuid,p_tryout_id uuid)
returns table(
  registration_id uuid,division_id uuid,session_id uuid,group_id uuid,
  display_name text,division_name text,session_name text,group_name text,
  tryout_number integer,identity_mode text
)
language sql stable security definer set search_path = '' as $$
  select distinct on (r.id,e.session_id,e.group_id)
    r.id,r.division_id,e.session_id,e.group_id,
    case when t.blind_mode then 'Athlete '||upper(substr(replace(r.id::text,'-',''),1,6))
      else a.given_name||' '||a.family_name end,
    d.name,s.name,g.name,n.number,
    case when t.blind_mode then 'blind' else 'full' end
  from public.tryout_registrations r
  join public.tryouts t on t.organization_id=r.organization_id and t.id=r.tryout_id
  join public.athletes a on a.organization_id=r.organization_id and a.id=r.athlete_id
  join public.tryout_divisions d on d.organization_id=r.organization_id and d.tryout_id=r.tryout_id and d.id=r.division_id
  left join public.session_enrollments e on e.organization_id=r.organization_id and e.tryout_id=r.tryout_id and e.registration_id=r.id
  left join public.tryout_sessions s on s.organization_id=e.organization_id and s.tryout_id=e.tryout_id and s.id=e.session_id
  left join public.session_groups g on g.organization_id=e.organization_id and g.tryout_id=e.tryout_id and g.session_id=e.session_id and g.id=e.group_id
  left join lateral (
    select number from public.tryout_numbers candidate
    where candidate.organization_id=r.organization_id and candidate.tryout_id=r.tryout_id
      and candidate.registration_id=r.id and candidate.released_at is null
      and (candidate.session_id is null or candidate.session_id=e.session_id)
      and (candidate.group_id is null or candidate.group_id=e.group_id)
    order by case candidate.scope_kind when 'group' then 1 when 'session' then 2 when 'division' then 3 else 4 end,candidate.id
    limit 1
  ) n on true
  where r.organization_id=p_organization_id and r.tryout_id=p_tryout_id and r.status='submitted'
    and t.status in ('published','finalized')
    and public.is_active_organization_member(p_organization_id)
    and exists(
      select 1 from public.tryout_staff_assignments grant_record
      where grant_record.organization_id=p_organization_id and grant_record.tryout_id=p_tryout_id
        and grant_record.user_id=auth.uid() and grant_record.role='evaluator'
        and grant_record.revoked_at is null
        and (grant_record.expires_at is null or grant_record.expires_at>clock_timestamp())
        and (
          grant_record.scope_kind='tryout'
          or (grant_record.scope_kind='division' and grant_record.division_id=r.division_id)
          or (grant_record.scope_kind='session' and grant_record.session_id=e.session_id)
          or (grant_record.scope_kind='group' and grant_record.group_id=e.group_id)
        )
    )
  order by r.id,e.session_id nulls first,e.group_id nulls first;
$$;

create or replace function public.list_tryout_evaluator_candidates(p_organization_id uuid,p_tryout_id uuid)
returns table(evaluator_user_id uuid,display_name text,active_assignment_count bigint)
language sql stable security definer set search_path = '' as $$
  select m.user_id,coalesce(nullif(trim(p.display_name),''),'Evaluator'),
    (
      select count(*)
      from public.tryout_staff_assignments a
      where a.organization_id=m.organization_id and a.user_id=m.user_id and a.role='evaluator'
        and a.tryout_id=p_tryout_id and a.revoked_at is null
        and (a.expires_at is null or a.expires_at>clock_timestamp())
        and public.can_manage_evaluator_scope(
          a.organization_id,a.tryout_id,a.scope_kind,a.division_id,a.session_id,a.group_id
        )
    )
  from public.organization_members m
  left join public.profiles p on p.id=m.user_id
  where m.organization_id=p_organization_id and m.status='active'
    and (
      public.can_manage_tryout_root(p_organization_id,p_tryout_id)
      or (
        public.is_active_organization_member(p_organization_id)
        and exists(
          select 1 from public.tryout_staff_assignments director
          where director.organization_id=p_organization_id and director.tryout_id=p_tryout_id
            and director.user_id=auth.uid() and director.role='director' and director.revoked_at is null
            and (director.expires_at is null or director.expires_at>clock_timestamp())
        )
      )
    )
  order by 2,m.user_id;
$$;

create function public.list_manageable_evaluator_assignments(p_organization_id uuid,p_tryout_id uuid)
returns table(
  assignment_id uuid,evaluator_user_id uuid,evaluator_name text,scope_kind text,
  division_id uuid,session_id uuid,group_id uuid,scope_label text,expires_at timestamptz
)
language sql stable security definer set search_path = '' as $$
  select a.id,a.user_id,coalesce(nullif(trim(p.display_name),''),'Evaluator'),a.scope_kind,
    a.division_id,a.session_id,a.group_id,
    case a.scope_kind
      when 'tryout' then t.name||' — all divisions'
      when 'division' then d.name||' division'
      when 'session' then coalesce(d.name||' — ','')||s.name
      when 'group' then s.name||' — '||g.name
    end,
    a.expires_at
  from public.tryout_staff_assignments a
  join public.tryouts t on t.organization_id=a.organization_id and t.id=a.tryout_id
  left join public.profiles p on p.id=a.user_id
  left join public.tryout_divisions d on d.organization_id=a.organization_id and d.tryout_id=a.tryout_id
    and d.id=coalesce(a.division_id,(select ts.division_id from public.tryout_sessions ts where ts.organization_id=a.organization_id and ts.tryout_id=a.tryout_id and ts.id=a.session_id))
  left join public.tryout_sessions s on s.organization_id=a.organization_id and s.tryout_id=a.tryout_id and s.id=a.session_id
  left join public.session_groups g on g.organization_id=a.organization_id and g.tryout_id=a.tryout_id and g.session_id=a.session_id and g.id=a.group_id
  where a.organization_id=p_organization_id and a.tryout_id=p_tryout_id and a.role='evaluator'
    and a.revoked_at is null and (a.expires_at is null or a.expires_at>clock_timestamp())
    and public.can_manage_evaluator_scope(a.organization_id,a.tryout_id,a.scope_kind,a.division_id,a.session_id,a.group_id)
  order by 3,a.scope_kind,a.id;
$$;

revoke all on public.tryout_staff_assignments from public,anon,authenticated,service_role;
grant select on public.tryout_staff_assignments to authenticated;

revoke all on function public.revoke_orphaned_staff_assignments() from public,anon,authenticated,service_role;
revoke all on function public.revoke_staff_assignments_on_offboarding() from public,anon,authenticated,service_role;
revoke all on function public.assign_evaluator(uuid,uuid,uuid,text,uuid,uuid,uuid,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.list_assigned_athletes(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.list_tryout_evaluator_candidates(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.list_manageable_evaluator_assignments(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.assign_evaluator(uuid,uuid,uuid,text,uuid,uuid,uuid,timestamptz) to authenticated;
grant execute on function public.list_assigned_athletes(uuid,uuid) to authenticated;
grant execute on function public.list_tryout_evaluator_candidates(uuid,uuid) to authenticated;
grant execute on function public.list_manageable_evaluator_assignments(uuid,uuid) to authenticated;
