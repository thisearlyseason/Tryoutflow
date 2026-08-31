-- Per-athlete witness rows make one natural key correct, but transactions that
-- touch two athletes can acquire those rows in opposite order.  A durable UUID
-- fence serializes report-population maintenance once per organization before
-- any per-key witness is mutated.  Unlike a hashed advisory key, this exact key
-- cannot collide across tenants.
create table if not exists private.report_population_organization_fences (
  organization_id uuid primary key
    references public.organizations(id) on delete cascade
);

alter table private.report_population_organization_fences enable row level security;
revoke all on table private.report_population_organization_fences
from public,anon,authenticated,service_role;

insert into private.report_population_organization_fences(organization_id)
select organization.id from public.organizations organization
on conflict (organization_id) do nothing;

-- ENABLE ALWAYS trigger paths can be used while ordinary foreign-key triggers
-- are suppressed by a privileged replica-role maintenance session.  Repair any
-- fence orphan left by such a pre-087 or replay interval before installing the
-- explicit owner-delete cleanup below.
delete from private.report_population_organization_fences fence
where not exists(
  select 1 from public.organizations organization
  where organization.id=fence.organization_id
);

create or replace function private.cleanup_report_population_organization_fence()
returns trigger
language plpgsql volatile security definer set search_path='' as $$
begin
  delete from private.report_population_organization_fences fence
  where fence.organization_id=old.id;
  return old;
end;
$$;

drop trigger if exists cleanup_report_population_organization_fence
  on public.organizations;
create trigger cleanup_report_population_organization_fence
after delete on public.organizations
for each row execute function private.cleanup_report_population_organization_fence();
alter table public.organizations
  enable always trigger cleanup_report_population_organization_fence;

create or replace function private.lock_report_population_organization(
  p_organization_id uuid
) returns boolean
language plpgsql volatile security definer set search_path='' as $$
begin
  -- During an organization cascade there is no population mutation left to
  -- protect: both the fence and population are children of the disappearing
  -- tenant.  Avoid recreating a child for an already-deleted parent.
  if not exists(
    select 1 from public.organizations organization
    where organization.id=p_organization_id
  ) then
    return false;
  end if;

  insert into private.report_population_organization_fences(organization_id)
  values(p_organization_id)
  on conflict (organization_id) do nothing;

  perform fence.organization_id
  from private.report_population_organization_fences fence
  where fence.organization_id=p_organization_id
  for update;
  return found;
end;
$$;

create or replace function private.lock_all_report_population_organizations()
returns bigint
language plpgsql volatile security definer set search_path='' as $$
declare locked_count bigint;
begin
  insert into private.report_population_organization_fences(organization_id)
  select organization.id from public.organizations organization
  on conflict (organization_id) do nothing;

  -- UUID order is canonical for the table-wide truncate/rebuild paths.
  perform fence.organization_id
  from private.report_population_organization_fences fence
  order by fence.organization_id
  for update;
  get diagnostics locked_count=row_count;
  return locked_count;
end;
$$;

-- Rebuild first excludes concurrent registration writers with the same table
-- lock used by 086, then takes every organization fence in canonical order.
-- All population inserts/deletes therefore happen after the fence boundary.
create or replace function private.rebuild_report_tryout_athlete_population()
returns bigint
language plpgsql volatile security definer set search_path='' as $$
declare population_count bigint;
begin
  lock table public.tryout_registrations in share row exclusive mode;
  perform private.lock_all_report_population_organizations();

  insert into private.report_tryout_athlete_population(
    organization_id,tryout_id,athlete_id,registration_count
  )
  select registration.organization_id,registration.tryout_id,
    registration.athlete_id,count(*)
  from public.tryout_registrations registration
  group by registration.organization_id,registration.tryout_id,registration.athlete_id
  on conflict (organization_id,tryout_id,athlete_id) do update
    set registration_count=excluded.registration_count;

  delete from private.report_tryout_athlete_population population
  where not exists(
    select 1
    from public.tryout_registrations registration
    where registration.organization_id=population.organization_id
      and registration.tryout_id=population.tryout_id
      and registration.athlete_id=population.athlete_id
  );

  select count(*) into population_count
  from private.report_tryout_athlete_population;
  return population_count;
end;
$$;

create or replace function private.maintain_report_tryout_athlete_population()
returns trigger
language plpgsql volatile security definer set search_path='' as $$
declare remaining bigint;
begin
  if tg_op='INSERT' then
    if not private.lock_report_population_organization(new.organization_id) then
      raise exception 'report population organization fence is unavailable'
        using errcode='23503';
    end if;
    insert into private.report_tryout_athlete_population(
      organization_id,tryout_id,athlete_id,registration_count
    ) values(new.organization_id,new.tryout_id,new.athlete_id,1)
    on conflict (organization_id,tryout_id,athlete_id) do update
      set registration_count=
        private.report_tryout_athlete_population.registration_count+1;
    return new;
  end if;

  if tg_op='DELETE' then
    if not private.lock_report_population_organization(old.organization_id) then
      return old;
    end if;
    update private.report_tryout_athlete_population population
    set registration_count=population.registration_count-1
    where population.organization_id=old.organization_id
      and population.tryout_id=old.tryout_id
      and population.athlete_id=old.athlete_id
      and population.registration_count>0
    returning registration_count into remaining;

    if found and remaining=0 then
      delete from private.report_tryout_athlete_population population
      where population.organization_id=old.organization_id
        and population.tryout_id=old.tryout_id
        and population.athlete_id=old.athlete_id
        and population.registration_count=0;
    elsif not found
      and exists(select 1 from public.tryouts target
        where target.organization_id=old.organization_id and target.id=old.tryout_id)
      and exists(select 1 from public.athletes athlete
        where athlete.organization_id=old.organization_id and athlete.id=old.athlete_id)
      and exists(select 1 from public.tryout_registrations registration
        where registration.organization_id=old.organization_id
          and registration.tryout_id=old.tryout_id
          and registration.athlete_id=old.athlete_id)
    then
      raise exception 'report tryout athlete population is inconsistent'
        using errcode='23514';
    end if;
    return old;
  end if;

  perform private.lock_all_report_population_organizations();
  truncate table private.report_tryout_athlete_population;
  return null;
end;
$$;

-- This owner-only SECURITY INVOKER SQL function is the one production calls
-- and pgTAP explains.  Every name is schema-qualified, so no function-level SET
-- clause is needed; PostgreSQL can inline the body into EXPLAIN ANALYZE.
create or replace function private.explainable_report_athlete_candidates(
  p_organization_id uuid,p_tryout_id uuid,p_max_rows integer
) returns table(athlete_id uuid,registration_id uuid)
language sql stable security invoker as $$
  with organization_candidates as materialized (
    select athlete.id athlete_id,registration.id registration_id
    from public.athletes athlete
    left join lateral (
      select registration.id
      from public.tryout_registrations registration
      where registration.organization_id=p_organization_id
        and registration.athlete_id=athlete.id
      order by registration.created_at desc,registration.id desc
      limit 1
    ) registration on true
    where p_tryout_id is null and athlete.organization_id=p_organization_id
    order by athlete.id
    limit (p_max_rows+1)
  ), bounded_tryout_population as materialized (
    select population.athlete_id
    from private.report_tryout_athlete_population population
    where p_tryout_id is not null
      and population.organization_id=p_organization_id
      and population.tryout_id=p_tryout_id
      and population.registration_count>0
    order by population.athlete_id
    limit (p_max_rows+1)
  ), tryout_candidates as materialized (
    select population.athlete_id,registration.id registration_id
    from bounded_tryout_population population
    join lateral (
      select registration.id
      from public.tryout_registrations registration
      where registration.organization_id=p_organization_id
        and registration.tryout_id=p_tryout_id
        and registration.athlete_id=population.athlete_id
      order by registration.created_at desc,registration.id desc
      limit 1
    ) registration on true
    order by population.athlete_id
  )
  select * from organization_candidates
  union all
  select * from tryout_candidates
  order by athlete_id;
$$;

-- Preserve the 083-086 owner boundary for internal callers that still use the
-- established name.  Production report export is redefined below to bypass
-- this wrapper and invoke the explainable function exactly.
create or replace function private.bounded_report_athlete_candidates(
  p_organization_id uuid,p_tryout_id uuid,p_max_rows integer
) returns table(athlete_id uuid,registration_id uuid)
language sql stable security definer set search_path='' as $$
  select * from private.explainable_report_athlete_candidates(
    p_organization_id,p_tryout_id,p_max_rows
  );
$$;

create or replace function public.load_report_export(
  p_organization_id uuid,p_export_type text,p_tryout_id uuid default null,
  p_roster_version_id uuid default null,p_max_rows integer default 5000
) returns table(result jsonb)
language plpgsql stable security definer set search_path='' as $$
declare target_roster public.roster_versions%rowtype; permitted boolean:=false; scope_label text;
declare payload jsonb; overflow boolean:=false; snapshot private.roster_report_snapshots%rowtype;
begin
  if p_max_rows not between 1 and 5000 or p_export_type not in ('athletes','evaluations','roster') then
    return query select jsonb_build_object('outcome','forbidden'); return;
  end if;
  if p_export_type='athletes' then
    permitted:=case when p_tryout_id is null then public.is_active_organization_member(p_organization_id,array['owner','administrator'])
      else private.can_read_report_scope(p_organization_id,p_tryout_id) end;
  elsif p_export_type='evaluations' then
    permitted:=p_tryout_id is not null and private.can_read_report_scope(p_organization_id,p_tryout_id);
  else
    if p_tryout_id is null or p_roster_version_id is null then return query select jsonb_build_object('outcome','forbidden'); return; end if;
    select roster.* into target_roster from public.roster_versions roster where roster.organization_id=p_organization_id
      and roster.tryout_id=p_tryout_id and roster.id=p_roster_version_id;
    if not found then return query select jsonb_build_object('outcome','forbidden'); return; end if;
    if target_roster.state<>'finalized' then
      return query select jsonb_build_object('outcome',case when private.can_read_roster(p_organization_id,p_tryout_id,target_roster.division_id,false) then 'not_finalized' else 'forbidden' end); return;
    end if;
    permitted:=private.can_read_roster(p_organization_id,p_tryout_id,target_roster.division_id,true);
  end if;
  if not permitted or (p_tryout_id is not null and not exists(select 1 from public.tryouts where organization_id=p_organization_id and id=p_tryout_id)) then
    return query select jsonb_build_object('outcome','forbidden'); return;
  end if;
  select case when p_tryout_id is null then organization.name else organization.name||' - '||target.name end into scope_label
  from public.organizations organization left join public.tryouts target on target.organization_id=organization.id and target.id=p_tryout_id
  where organization.id=p_organization_id;
  if scope_label is null then return query select jsonb_build_object('outcome','forbidden'); return; end if;

  if p_export_type='athletes' then
    with candidates as materialized(select * from private.explainable_report_athlete_candidates(p_organization_id,p_tryout_id,p_max_rows)),
    bounded as materialized(select * from candidates order by athlete_id limit p_max_rows),
    rows as materialized(
      select athlete.id,athlete.given_name,athlete.family_name,registration.status,position.name position_name,
        (select number.number from public.tryout_numbers number where number.organization_id=p_organization_id
          and (p_tryout_id is null or number.tryout_id=p_tryout_id) and number.registration_id=registration.id and number.released_at is null
          order by case number.scope_kind when 'group' then 1 when 'session' then 2 when 'division' then 3 else 4 end,
            number.assigned_at desc,number.id limit 1) athlete_number
      from bounded candidate join public.athletes athlete on athlete.organization_id=p_organization_id and athlete.id=candidate.athlete_id
      left join public.tryout_registrations registration on registration.organization_id=p_organization_id and registration.id=candidate.registration_id
      left join public.tryout_positions position on position.organization_id=p_organization_id and position.tryout_id=registration.tryout_id and position.id=registration.position_id
    )
    select exists(select 1 from candidates offset p_max_rows),coalesce(jsonb_agg(jsonb_build_object(
      'athleteNumber',rows.athlete_number,'preferredName',rows.given_name,'familyName',rows.family_name,
      'position',rows.position_name,'registrationStatus',rows.status) order by rows.id),'[]'::jsonb)
    into overflow,payload from rows;
    return query select jsonb_build_object('outcome','ok','exportType','athletes','scopeLabel',scope_label,'rows',payload,'truncated',overflow); return;
  end if;

  if p_export_type='evaluations' then
    with candidates as materialized(select * from private.bounded_report_evaluation_candidates(p_organization_id,p_tryout_id,p_max_rows)),
    bounded as materialized(select * from candidates order by registration_id,session_id limit p_max_rows),
    evaluation_candidates as materialized(
      select evaluation.* from public.evaluations evaluation join bounded candidate
        on candidate.registration_id=evaluation.tryout_registration_id and candidate.session_id=evaluation.tryout_session_id
      where evaluation.organization_id=p_organization_id and evaluation.tryout_id=p_tryout_id
      order by evaluation.tryout_registration_id,evaluation.tryout_session_id,evaluation.id limit 10001
    ), score_candidates as materialized(
      select evaluation.id evaluation_id,category.id category_id,category.sort_order,
        score.value,category.scale_max,category.weight
      from evaluation_candidates evaluation join public.rubric_categories category
        on category.organization_id=evaluation.organization_id and category.tryout_id=evaluation.tryout_id
        and category.rubric_version_id=evaluation.rubric_version_id
      left join public.evaluation_scores score on score.organization_id=category.organization_id
        and score.evaluation_id=evaluation.id and score.rubric_category_id=category.id
      order by evaluation.id,category.sort_order,category.id limit 100001
    ), totals as materialized(
      select evaluation.id,evaluation.tryout_registration_id registration_id,evaluation.tryout_session_id session_id,evaluation.state,
        exists(select 1 from public.tryout_staff_assignments staff join public.organization_members member
          on member.organization_id=staff.organization_id and member.user_id=staff.user_id and member.status='active'
          join public.tryout_registrations registration on registration.organization_id=evaluation.organization_id and registration.id=evaluation.tryout_registration_id
          where staff.organization_id=evaluation.organization_id and staff.tryout_id=evaluation.tryout_id
            and staff.user_id=evaluation.evaluator_user_id and staff.role='evaluator' and staff.revoked_at is null
            and (staff.expires_at is null or staff.expires_at>clock_timestamp()) and (
              staff.scope_kind='tryout' or (staff.scope_kind='division' and staff.division_id=evaluation.division_id)
              or (staff.scope_kind='session' and staff.session_id=evaluation.tryout_session_id)
              or (staff.scope_kind='group' and staff.session_id=evaluation.tryout_session_id and staff.group_id=evaluation.group_id)
              or (staff.scope_kind='athlete' and staff.athlete_id=registration.athlete_id))) assignment_valid,
        case when count(score.category_id) between 1 and 100 then private.calculate_report_evaluator_total(jsonb_agg(jsonb_build_object(
          'categoryId',score.category_id,'score',score.value,'scaleMax',score.scale_max,'weight',score.weight::text)
          order by score.sort_order,score.category_id)) else null end evaluator_total,
        count(score.category_id)>100 category_overflow
      from evaluation_candidates evaluation left join score_candidates score on score.evaluation_id=evaluation.id
      group by evaluation.id,evaluation.tryout_registration_id,evaluation.tryout_session_id,
        evaluation.state,evaluation.organization_id,evaluation.tryout_id,evaluation.evaluator_user_id,
        evaluation.division_id,evaluation.group_id
    ), rows as materialized(
      select registration.id,session.id session_id,athlete.given_name,session.name session_name,
        (select number.number from public.tryout_numbers number where number.organization_id=p_organization_id
          and number.tryout_id=p_tryout_id and number.registration_id=registration.id and number.released_at is null
          order by case number.scope_kind when 'group' then 1 when 'session' then 2 when 'division' then 3 else 4 end,
            number.assigned_at desc,number.id limit 1) athlete_number,
        count(*) filter(where total.state='completed' and total.assignment_valid and total.evaluator_total is not null) completed_count,
        count(*) filter(where total.state='locked' and total.assignment_valid and total.evaluator_total is not null) locked_count,
        count(*) filter(where total.state='reopened') reopened_count,
        count(*) filter(where total.state='draft') draft_count,
        count(*) filter(where total.state in ('completed','locked') and (not total.assignment_valid or total.evaluator_total is null)) invalid_count,
        count(total.evaluator_total) filter(where total.state in ('completed','locked') and total.assignment_valid) scored_count,
        case when count(total.evaluator_total) filter(where total.state in ('completed','locked') and total.assignment_valid)=0 then null
          else to_char(round(avg(total.evaluator_total::numeric) filter(where total.state in ('completed','locked') and total.assignment_valid),4),'FM999990.0000') end overall_score
      from bounded candidate join public.tryout_registrations registration on registration.organization_id=p_organization_id and registration.id=candidate.registration_id
      join public.athletes athlete on athlete.organization_id=registration.organization_id and athlete.id=registration.athlete_id
      join public.tryout_sessions session on session.organization_id=p_organization_id and session.id=candidate.session_id
      left join totals total on total.registration_id=candidate.registration_id and total.session_id=candidate.session_id
      group by registration.id,session.id,athlete.given_name,session.name
    )
    select exists(select 1 from candidates offset p_max_rows)
      or (select count(*) from evaluation_candidates)>10000 or (select count(*) from score_candidates)>100000
      or exists(select 1 from totals where category_overflow),
      coalesce(jsonb_agg(jsonb_build_object('athleteNumber',rows.athlete_number,'preferredName',rows.given_name,
        'session',rows.session_name,'completedCount',rows.completed_count,'lockedCount',rows.locked_count,
        'reopenedCount',rows.reopened_count,'draftCount',rows.draft_count,'invalidCount',rows.invalid_count,
        'scoredEvaluatorCount',rows.scored_count,'overallScore',rows.overall_score)
        order by rows.id,rows.session_id),'[]'::jsonb)
    into overflow,payload from rows;
    return query select jsonb_build_object('outcome','ok','exportType','evaluations','scopeLabel',scope_label,'rows',payload,'truncated',overflow); return;
  end if;

  select * into snapshot from private.roster_report_snapshots report where report.organization_id=p_organization_id
    and report.tryout_id=p_tryout_id and report.division_id=target_roster.division_id and report.roster_version_id=p_roster_version_id;
  if not found then return query select jsonb_build_object('outcome','snapshot_unavailable'); return; end if;
  overflow:=snapshot.item_count>p_max_rows;
  select coalesce(jsonb_agg(jsonb_build_object('athleteNumber',item.athlete_number,
    'preferredName',item.preferred_name,'decision',item.decision,'team',item.team_name)
    order by item.athlete_number nulls last,item.registration_id),'[]'::jsonb) into payload
  from (select * from private.roster_report_snapshot_items where roster_version_id=p_roster_version_id
    order by athlete_number nulls last,registration_id limit p_max_rows) item;
  return query select jsonb_build_object('outcome','ok','exportType','roster','scopeLabel',scope_label,
    'snapshot',jsonb_build_object('rosterVersionId',snapshot.roster_version_id,'state','finalized',
      'finalizedAt',to_char(snapshot.finalized_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'rows',payload),
    'truncated',overflow);
end;
$$;

revoke all on function
  private.cleanup_report_population_organization_fence(),
  private.lock_report_population_organization(uuid),
  private.lock_all_report_population_organizations(),
  private.explainable_report_athlete_candidates(uuid,uuid,integer),
  private.bounded_report_athlete_candidates(uuid,uuid,integer)
from public,anon,authenticated,service_role;

-- Repair any pre-087 drift under the same table/fence order used by future
-- rebuild calls.  This also exercises the installed fence set during migration.
select private.rebuild_report_tryout_athlete_population();
