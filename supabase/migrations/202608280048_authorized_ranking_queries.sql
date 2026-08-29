-- Rankings are a guarded projection, never direct peer-evaluation table access.
-- Expected evaluator coverage is the current operational view: one opportunity
-- per active evaluator assignment and matching active session enrollment.

alter table public.tryout_registrations add column position_id uuid;
alter table public.tryout_registrations
  add constraint tryout_registrations_position_fkey
  foreign key (organization_id,tryout_id,position_id)
  references public.tryout_positions(organization_id,tryout_id,id) on delete restrict;
create index tryout_registrations_ranking_filters_idx
  on public.tryout_registrations(organization_id,tryout_id,division_id,position_id,id)
  where status='submitted';
create index evaluations_ranking_projection_idx
  on public.evaluations(organization_id,tryout_id,division_id,tryout_session_id,group_id,tryout_registration_id)
  where state in ('completed','locked');

create function private.ranking_assignment_matches(
  p_assignment_id uuid,
  p_organization_id uuid,
  p_tryout_id uuid,
  p_division_id uuid,
  p_session_id uuid,
  p_group_id uuid,
  p_athlete_id uuid,
  p_role text
) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(
    select 1 from public.tryout_staff_assignments a
    join public.organization_members m
      on m.organization_id=a.organization_id and m.user_id=a.user_id and m.status='active'
    where a.id=p_assignment_id and a.organization_id=p_organization_id
      and a.tryout_id=p_tryout_id and a.role=p_role
      and a.revoked_at is null and (a.expires_at is null or a.expires_at>clock_timestamp())
      and (
        a.scope_kind='tryout'
        or (a.scope_kind='division' and a.division_id=p_division_id)
        or (a.scope_kind='session' and a.session_id=p_session_id)
        or (a.scope_kind='group' and a.session_id=p_session_id and a.group_id=p_group_id)
        or (a.scope_kind='athlete' and a.athlete_id=p_athlete_id)
      )
  )
$$;

create function private.can_read_ranking_registration(
  p_organization_id uuid,p_tryout_id uuid,p_division_id uuid,
  p_session_id uuid,p_group_id uuid,p_athlete_id uuid
) returns boolean
language sql stable security definer set search_path='' as $$
  select public.is_active_organization_member(p_organization_id,array['owner','administrator'])
    or exists(
      select 1 from public.tryout_staff_assignments a
      where a.organization_id=p_organization_id and a.user_id=auth.uid()
        and a.tryout_id=p_tryout_id and a.role='director'
        and private.ranking_assignment_matches(a.id,p_organization_id,p_tryout_id,p_division_id,p_session_id,p_group_id,p_athlete_id,'director')
    )
    or (
      exists(select 1 from public.tryouts t where t.organization_id=p_organization_id and t.id=p_tryout_id and t.status='finalized')
      and exists(
        select 1 from public.tryout_staff_assignments a
        where a.organization_id=p_organization_id and a.user_id=auth.uid()
          and a.tryout_id=p_tryout_id and a.role='reviewer'
          and private.ranking_assignment_matches(a.id,p_organization_id,p_tryout_id,p_division_id,p_session_id,p_group_id,p_athlete_id,'reviewer')
      )
    )
$$;

create function private.can_read_live_registration(
  p_organization_id uuid,p_tryout_id uuid,p_division_id uuid,
  p_session_id uuid,p_group_id uuid,p_athlete_id uuid
) returns boolean
language sql stable security definer set search_path='' as $$
  select public.is_active_organization_member(p_organization_id,array['owner','administrator'])
    or exists(
      select 1 from public.tryout_staff_assignments a
      where a.organization_id=p_organization_id and a.user_id=auth.uid()
        and a.tryout_id=p_tryout_id and a.role='director'
        and private.ranking_assignment_matches(a.id,p_organization_id,p_tryout_id,p_division_id,p_session_id,p_group_id,p_athlete_id,'director')
    )
$$;

create function public.load_ranking_snapshot(
  p_organization_id uuid,p_tryout_id uuid,p_division_id uuid default null,
  p_position_id uuid default null,p_session_id uuid default null,p_group_id uuid default null,
  p_athlete_ids uuid[] default null
) returns table(result jsonb)
language plpgsql stable security definer set search_path='' as $$
declare permitted boolean;
declare broad_manager boolean;
declare scope_valid boolean;
declare payload jsonb;
begin
  if auth.uid() is null or not public.is_active_organization_member(p_organization_id) then
    return query select jsonb_build_object('outcome','forbidden'); return;
  end if;
  if p_athlete_ids is not null and (cardinality(p_athlete_ids) not between 2 and 4
    or cardinality(p_athlete_ids)<>(select count(distinct x) from unnest(p_athlete_ids) x)) then
    return query select jsonb_build_object('outcome','forbidden'); return;
  end if;
  broad_manager:=public.is_active_organization_member(p_organization_id,array['owner','administrator']);
  permitted:=broad_manager
    or exists(select 1 from public.tryout_staff_assignments a
      where a.organization_id=p_organization_id and a.tryout_id=p_tryout_id and a.user_id=auth.uid()
        and a.role='director' and a.revoked_at is null
        and (a.expires_at is null or a.expires_at>clock_timestamp()))
    or (exists(select 1 from public.tryouts t where t.organization_id=p_organization_id and t.id=p_tryout_id and t.status='finalized')
      and exists(select 1 from public.tryout_staff_assignments a
        where a.organization_id=p_organization_id and a.tryout_id=p_tryout_id and a.user_id=auth.uid()
          and a.role='reviewer' and a.revoked_at is null
          and (a.expires_at is null or a.expires_at>clock_timestamp())));
  if not permitted then return query select jsonb_build_object('outcome','forbidden'); return; end if;
  if not broad_manager and not exists(
    select 1 from public.tryout_staff_assignments a
    where a.organization_id=p_organization_id and a.tryout_id=p_tryout_id and a.user_id=auth.uid()
      and a.role in ('director','reviewer') and a.revoked_at is null
      and (a.expires_at is null or a.expires_at>clock_timestamp())
      and (a.scope_kind='tryout'
        or (a.scope_kind='division' and (p_division_id is null or a.division_id=p_division_id))
        or (a.scope_kind='session' and (p_session_id is null or a.session_id=p_session_id))
        or (a.scope_kind='group' and (p_session_id is null or a.session_id=p_session_id) and (p_group_id is null or a.group_id=p_group_id))
        or (a.scope_kind='athlete' and p_athlete_ids is not null and a.athlete_id=any(p_athlete_ids)))
  ) then return query select jsonb_build_object('outcome','forbidden'); return; end if;

  scope_valid:=exists(select 1 from public.tryouts t where t.organization_id=p_organization_id and t.id=p_tryout_id)
    and (p_division_id is null or exists(select 1 from public.tryout_divisions d where d.organization_id=p_organization_id and d.tryout_id=p_tryout_id and d.id=p_division_id))
    and (p_position_id is null or exists(select 1 from public.tryout_positions p where p.organization_id=p_organization_id and p.tryout_id=p_tryout_id and p.id=p_position_id))
    and (p_session_id is null or exists(select 1 from public.tryout_sessions s where s.organization_id=p_organization_id and s.tryout_id=p_tryout_id and s.id=p_session_id and (p_division_id is null or s.division_id=p_division_id)))
    and (p_group_id is null or (p_session_id is not null and exists(select 1 from public.session_groups g where g.organization_id=p_organization_id and g.tryout_id=p_tryout_id and g.session_id=p_session_id and g.id=p_group_id)));
  if not scope_valid then
    return query select jsonb_build_object('outcome',case when broad_manager then 'invalid_scope' else 'forbidden' end);
    return;
  end if;

  with registrations as (
    select r.*,a.given_name||' '||a.family_name as display_name,d.name as division_name,
      p.name as position_name
    from public.tryout_registrations r
    join public.athletes a on a.organization_id=r.organization_id and a.id=r.athlete_id
    join public.tryout_divisions d on d.organization_id=r.organization_id and d.tryout_id=r.tryout_id and d.id=r.division_id
    left join public.tryout_positions p on p.organization_id=r.organization_id and p.tryout_id=r.tryout_id and p.id=r.position_id
    where r.organization_id=p_organization_id and r.tryout_id=p_tryout_id and r.status='submitted'
      and (p_division_id is null or r.division_id=p_division_id)
      and (p_position_id is null or r.position_id=p_position_id)
      and (p_athlete_ids is null or r.athlete_id=any(p_athlete_ids))
      and exists(
        select 1 from public.session_enrollments se
        where se.organization_id=r.organization_id and se.tryout_id=r.tryout_id and se.registration_id=r.id
          and (p_session_id is null or se.session_id=p_session_id)
          and (p_group_id is null or se.group_id=p_group_id)
          and private.can_read_ranking_registration(r.organization_id,r.tryout_id,r.division_id,se.session_id,se.group_id,r.athlete_id)
      )
    order by r.id limit 10000
  )
  select jsonb_build_object(
    'outcome','ok',
    'snapshot',jsonb_build_object(
      'generatedAt',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'registrations',coalesce(jsonb_agg(jsonb_build_object(
        'registrationId',r.id,'athleteId',r.athlete_id,'displayName',r.display_name,
        'divisionId',r.division_id,'divisionName',r.division_name,
        'positionId',r.position_id,'positionName',r.position_name,
        'tryoutNumber',(
          select n.number from public.tryout_numbers n
          where n.organization_id=r.organization_id and n.tryout_id=r.tryout_id and n.registration_id=r.id and n.released_at is null
          order by case n.scope_kind when 'group' then 1 when 'session' then 2 when 'division' then 3 else 4 end,n.assigned_at desc limit 1
        ),
        'expectedEvaluators',(
          select count(*) from (
            select distinct se.session_id,staff.user_id
            from public.session_enrollments se
            join public.tryout_staff_assignments staff on staff.organization_id=se.organization_id and staff.tryout_id=se.tryout_id and staff.role='evaluator'
            join public.organization_members member on member.organization_id=staff.organization_id and member.user_id=staff.user_id and member.status='active'
            where se.organization_id=r.organization_id and se.tryout_id=r.tryout_id and se.registration_id=r.id
              and (p_session_id is null or se.session_id=p_session_id) and (p_group_id is null or se.group_id=p_group_id)
              and staff.revoked_at is null and (staff.expires_at is null or staff.expires_at>clock_timestamp())
              and (staff.scope_kind='tryout' or (staff.scope_kind='division' and staff.division_id=r.division_id)
                or (staff.scope_kind='session' and staff.session_id=se.session_id)
                or (staff.scope_kind='group' and staff.session_id=se.session_id and staff.group_id=se.group_id)
                or (staff.scope_kind='athlete' and staff.athlete_id=r.athlete_id))
          ) expected
        ),
        'evaluations',coalesce((
          select jsonb_agg(jsonb_build_object(
            'evaluationId',e.id,'evaluatorId',e.id,'divisionId',e.division_id,
            'sessionId',e.tryout_session_id,'groupId',e.group_id,'state',e.state,'assignmentState','active',
            'categories',coalesce((select jsonb_agg(jsonb_build_object(
              'categoryId',c.id,'categoryName',c.name,'score',s.value,'scaleMax',c.scale_max,
              'weight',c.weight::text,'isPriority',c.is_priority
            ) order by c.sort_order,c.id)
            from public.rubric_categories c join public.evaluation_scores s
              on s.organization_id=c.organization_id and s.tryout_id=c.tryout_id and s.rubric_version_id=c.rubric_version_id
             and s.rubric_category_id=c.id and s.evaluation_id=e.id
            where c.organization_id=e.organization_id and c.tryout_id=e.tryout_id and c.rubric_version_id=e.rubric_version_id),'[]'::jsonb)
          ) order by e.tryout_session_id,e.id)
          from public.evaluations e
          join public.organization_members em on em.organization_id=e.organization_id and em.user_id=e.evaluator_user_id and em.status='active'
          join public.rubric_versions rv on rv.organization_id=e.organization_id and rv.tryout_id=e.tryout_id and rv.id=e.rubric_version_id and rv.status='published'
          join public.session_rubrics sr on sr.organization_id=e.organization_id and sr.tryout_id=e.tryout_id and sr.session_id=e.tryout_session_id and sr.rubric_version_id=e.rubric_version_id
          where e.organization_id=r.organization_id and e.tryout_id=r.tryout_id and e.tryout_registration_id=r.id
            and e.state in ('completed','locked') and (p_session_id is null or e.tryout_session_id=p_session_id)
            and (p_group_id is null or e.group_id=p_group_id)
            and exists(select 1 from public.tryout_staff_assignments ea
              where ea.organization_id=e.organization_id and ea.tryout_id=e.tryout_id and ea.user_id=e.evaluator_user_id and ea.role='evaluator'
                and ea.revoked_at is null and (ea.expires_at is null or ea.expires_at>clock_timestamp())
                and (ea.scope_kind='tryout' or (ea.scope_kind='division' and ea.division_id=e.division_id)
                  or (ea.scope_kind='session' and ea.session_id=e.tryout_session_id)
                  or (ea.scope_kind='group' and ea.session_id=e.tryout_session_id and ea.group_id=e.group_id)
                  or (ea.scope_kind='athlete' and ea.athlete_id=r.athlete_id)))
        ),'[]'::jsonb),
        'categoryNames',coalesce((
          select jsonb_agg(jsonb_build_object('id',categories.id,'name',categories.name,'scaleMax',categories.scale_max) order by categories.id)
          from (select distinct c.id,c.name,c.scale_max from public.session_enrollments se
            join public.session_rubrics sr on sr.organization_id=se.organization_id and sr.tryout_id=se.tryout_id and sr.session_id=se.session_id
            join public.rubric_categories c on c.organization_id=sr.organization_id and c.tryout_id=sr.tryout_id and c.rubric_version_id=sr.rubric_version_id
            where se.organization_id=r.organization_id and se.tryout_id=r.tryout_id and se.registration_id=r.id
              and (p_session_id is null or se.session_id=p_session_id) and (p_group_id is null or se.group_id=p_group_id)) categories
        ),'[]'::jsonb),
        'sessions',coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'name',x.name) order by x.id) from (
          select distinct s.id,s.name from public.session_enrollments se join public.tryout_sessions s
            on s.organization_id=se.organization_id and s.tryout_id=se.tryout_id and s.id=se.session_id
          where se.organization_id=r.organization_id and se.tryout_id=r.tryout_id and se.registration_id=r.id
            and (p_session_id is null or se.session_id=p_session_id) and (p_group_id is null or se.group_id=p_group_id)
        ) x),'[]'::jsonb),
        'groups',coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'name',x.name) order by x.id) from (
          select distinct g.id,g.name from public.session_enrollments se join public.session_groups g
            on g.organization_id=se.organization_id and g.tryout_id=se.tryout_id and g.session_id=se.session_id and g.id=se.group_id
          where se.organization_id=r.organization_id and se.tryout_id=r.tryout_id and se.registration_id=r.id
            and (p_session_id is null or se.session_id=p_session_id) and (p_group_id is null or se.group_id=p_group_id)
        ) x),'[]'::jsonb),
        'flags',coalesce((select jsonb_agg(x.flag_type order by x.flag_type) from (
          select distinct f.flag_type from public.athlete_flags f
          where f.organization_id=r.organization_id and f.tryout_id=r.tryout_id and f.tryout_registration_id=r.id and f.revoked_at is null
            and (p_session_id is null or f.tryout_session_id=p_session_id) and (p_group_id is null or f.group_id=p_group_id)
            -- Evaluator-created flags are part of an evaluator's raw work.  Keep
            -- ranking projections operational and privacy-safe by exposing only
            -- director-created flags; evaluator details stay in the evaluation
            -- workflow that owns their authorization semantics.
            and f.creator_kind='director'
        ) x),'[]'::jsonb)
      ) order by r.id),'[]'::jsonb)
    )
  ) into payload from registrations r;
  return query select payload;
end;
$$;

create function public.load_live_dashboard(
  p_organization_id uuid,p_tryout_id uuid,p_division_id uuid default null,
  p_session_id uuid default null,p_group_id uuid default null
) returns table(result jsonb)
language plpgsql stable security definer set search_path='' as $$
declare permitted boolean;
declare broad_manager boolean;
begin
  broad_manager:=auth.uid() is not null and public.is_active_organization_member(p_organization_id,array['owner','administrator']);
  permitted:=auth.uid() is not null and public.is_active_organization_member(p_organization_id)
    and (broad_manager
      or exists(select 1 from public.tryout_staff_assignments a where a.organization_id=p_organization_id and a.tryout_id=p_tryout_id and a.user_id=auth.uid() and a.role='director' and a.revoked_at is null and (a.expires_at is null or a.expires_at>clock_timestamp())));
  if not permitted then return query select jsonb_build_object('outcome','forbidden'); return; end if;
  if not broad_manager and not exists(
    select 1 from public.tryout_staff_assignments a
    where a.organization_id=p_organization_id and a.tryout_id=p_tryout_id and a.user_id=auth.uid()
      and a.role='director' and a.revoked_at is null and (a.expires_at is null or a.expires_at>clock_timestamp())
      and (a.scope_kind='tryout'
        or (a.scope_kind='division' and (p_division_id is null or a.division_id=p_division_id))
        or (a.scope_kind='session' and (p_session_id is null or a.session_id=p_session_id))
        or (a.scope_kind='group' and (p_session_id is null or a.session_id=p_session_id) and (p_group_id is null or a.group_id=p_group_id)))
  ) then return query select jsonb_build_object('outcome','forbidden'); return; end if;
  if not exists(select 1 from public.tryouts t where t.organization_id=p_organization_id and t.id=p_tryout_id)
    or (p_division_id is not null and not exists(select 1 from public.tryout_divisions d where d.organization_id=p_organization_id and d.tryout_id=p_tryout_id and d.id=p_division_id))
    or (p_session_id is not null and not exists(select 1 from public.tryout_sessions s where s.organization_id=p_organization_id and s.tryout_id=p_tryout_id and s.id=p_session_id and (p_division_id is null or s.division_id=p_division_id)))
    or (p_group_id is not null and (p_session_id is null or not exists(select 1 from public.session_groups g where g.organization_id=p_organization_id and g.tryout_id=p_tryout_id and g.session_id=p_session_id and g.id=p_group_id)))
  then return query select jsonb_build_object('outcome',case when broad_manager then 'invalid_scope' else 'forbidden' end); return; end if;
  return query
  with eligible as (
    select distinct r.id,r.athlete_id,r.division_id,se.session_id,se.group_id
    from public.tryout_registrations r join public.session_enrollments se
      on se.organization_id=r.organization_id and se.tryout_id=r.tryout_id and se.registration_id=r.id
    where r.organization_id=p_organization_id and r.tryout_id=p_tryout_id and r.status='submitted'
      and (p_division_id is null or r.division_id=p_division_id) and (p_session_id is null or se.session_id=p_session_id)
      and (p_group_id is null or se.group_id=p_group_id)
      and private.can_read_live_registration(r.organization_id,r.tryout_id,r.division_id,se.session_id,se.group_id,r.athlete_id)
  ), expected as (
    select distinct e.id,e.session_id,a.user_id from eligible e join public.tryout_staff_assignments a
      on a.organization_id=p_organization_id and a.tryout_id=p_tryout_id and a.role='evaluator'
    join public.organization_members m on m.organization_id=a.organization_id and m.user_id=a.user_id and m.status='active'
    where a.revoked_at is null and (a.expires_at is null or a.expires_at>clock_timestamp())
      and (a.scope_kind='tryout' or (a.scope_kind='division' and a.division_id=e.division_id)
        or (a.scope_kind='session' and a.session_id=e.session_id)
        or (a.scope_kind='group' and a.session_id=e.session_id and a.group_id=e.group_id)
        or (a.scope_kind='athlete' and a.athlete_id=e.athlete_id))
  )
  select jsonb_build_object('outcome','ok','dashboard',jsonb_build_object(
    'registrations',(select count(distinct id) from eligible),
    'checkedIn',(select count(distinct c.registration_id) from public.checkins c join eligible e on e.id=c.registration_id and e.session_id=c.session_id),
    'activeEvaluators',(select count(distinct user_id) from expected),
    'expectedEvaluations',(select count(*) from expected),
    'completedEvaluations',(select count(*) from public.evaluations ev join expected x on x.id=ev.tryout_registration_id and x.session_id=ev.tryout_session_id and x.user_id=ev.evaluator_user_id where ev.state in ('completed','locked')),
    'syncNeedsAttention',(select count(*) from public.evaluation_mutations em join public.evaluations ev on ev.organization_id=em.organization_id and ev.id=em.evaluation_id join eligible x on x.id=ev.tryout_registration_id and x.session_id=ev.tryout_session_id where em.outcome<>'synced'),
    'generatedAt',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
  ));
end;
$$;

revoke all on function private.ranking_assignment_matches(uuid,uuid,uuid,uuid,uuid,uuid,uuid,text) from public,anon,authenticated,service_role;
revoke all on function private.can_read_ranking_registration(uuid,uuid,uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function private.can_read_live_registration(uuid,uuid,uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.load_ranking_snapshot(uuid,uuid,uuid,uuid,uuid,uuid,uuid[]) from public,anon,authenticated,service_role;
revoke all on function public.load_live_dashboard(uuid,uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.load_ranking_snapshot(uuid,uuid,uuid,uuid,uuid,uuid,uuid[]) to authenticated;
grant execute on function public.load_live_dashboard(uuid,uuid,uuid,uuid,uuid) to authenticated;
