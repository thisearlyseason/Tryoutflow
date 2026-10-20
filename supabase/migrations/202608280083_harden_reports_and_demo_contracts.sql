-- Finalized report data is captured transactionally and never reconstructed
-- from mutable athlete or number records. Report candidate scans are bounded
-- before descriptive joins and nested scoring work.

create table private.roster_report_snapshots (
  roster_version_id uuid primary key references public.roster_versions(id) on delete restrict,
  organization_id uuid not null,
  tryout_id uuid not null,
  division_id uuid not null,
  finalized_at timestamptz not null,
  item_count integer not null check(item_count between 0 and 5000),
  captured_at timestamptz not null,
  constraint roster_report_snapshots_scope_key unique(organization_id,tryout_id,division_id,roster_version_id),
  constraint roster_report_snapshots_roster_fkey foreign key(organization_id,tryout_id,division_id,roster_version_id)
    references public.roster_versions(organization_id,tryout_id,division_id,id) on delete restrict
);

create table private.roster_report_snapshot_items (
  organization_id uuid not null,
  tryout_id uuid not null,
  division_id uuid not null,
  roster_version_id uuid not null,
  registration_id uuid not null,
  athlete_number integer,
  preferred_name text not null,
  decision text not null,
  team_name text,
  primary key(roster_version_id,registration_id),
  constraint roster_report_snapshot_items_header_fkey foreign key(organization_id,tryout_id,division_id,roster_version_id)
    references private.roster_report_snapshots(organization_id,tryout_id,division_id,roster_version_id) on delete restrict,
  constraint roster_report_snapshot_items_number_check check(athlete_number is null or athlete_number between 0 and 999999),
  constraint roster_report_snapshot_items_name_check check(char_length(preferred_name) between 1 and 120),
  constraint roster_report_snapshot_items_decision_check check(decision in ('undecided','callback','selected','waitlisted','released','withdrawn')),
  constraint roster_report_snapshot_items_team_check check(team_name is null or char_length(team_name) between 1 and 120)
);
create index roster_report_snapshot_items_order_idx
  on private.roster_report_snapshot_items(roster_version_id,athlete_number,registration_id);

revoke all on private.roster_report_snapshots,private.roster_report_snapshot_items from public,anon,authenticated,service_role;

create function private.prevent_roster_report_snapshot_mutation() returns trigger
language plpgsql set search_path='' as $$
begin
  raise exception 'finalized report snapshots are immutable' using errcode='55000';
end;
$$;
create trigger prevent_roster_report_snapshot_update_delete
before update or delete on private.roster_report_snapshots
for each row execute function private.prevent_roster_report_snapshot_mutation();
create trigger prevent_roster_report_snapshot_item_update_delete
before update or delete on private.roster_report_snapshot_items
for each row execute function private.prevent_roster_report_snapshot_mutation();
alter table private.roster_report_snapshots enable always trigger prevent_roster_report_snapshot_update_delete;
alter table private.roster_report_snapshot_items enable always trigger prevent_roster_report_snapshot_item_update_delete;

create function private.capture_roster_report_snapshot(
  p_organization_id uuid,p_tryout_id uuid,p_division_id uuid,p_roster_version_id uuid,p_finalized_at timestamptz
) returns void language plpgsql volatile security definer set search_path='' as $$
declare captured integer;
begin
  if p_finalized_at is null or not exists(
    select 1 from public.roster_versions version
    where version.organization_id=p_organization_id and version.tryout_id=p_tryout_id
      and version.division_id=p_division_id and version.id=p_roster_version_id and version.state='draft'
  ) or exists(select 1 from private.roster_report_snapshots where roster_version_id=p_roster_version_id) then
    raise exception 'roster report snapshot cannot be captured' using errcode='55000';
  end if;
  select count(*) into captured from public.roster_decisions decision
    where decision.organization_id=p_organization_id and decision.tryout_id=p_tryout_id
      and decision.division_id=p_division_id and decision.roster_version_id=p_roster_version_id;
  if captured>5000 then raise exception 'roster report snapshot exceeds 5000 items' using errcode='54000'; end if;
  insert into private.roster_report_snapshots(
    roster_version_id,organization_id,tryout_id,division_id,finalized_at,item_count,captured_at
  ) values(p_roster_version_id,p_organization_id,p_tryout_id,p_division_id,p_finalized_at,captured,p_finalized_at);
  insert into private.roster_report_snapshot_items(
    organization_id,tryout_id,division_id,roster_version_id,registration_id,
    athlete_number,preferred_name,decision,team_name
  )
  select decision.organization_id,decision.tryout_id,decision.division_id,decision.roster_version_id,
    decision.registration_id,
    (select number.number from public.tryout_numbers number
      where number.organization_id=decision.organization_id and number.tryout_id=decision.tryout_id
        and number.registration_id=decision.registration_id and number.released_at is null
      order by case number.scope_kind when 'group' then 1 when 'session' then 2 when 'division' then 3 else 4 end,
        number.assigned_at desc,number.id limit 1),
    athlete.given_name,decision.status,team.name
  from public.roster_decisions decision
  join public.tryout_registrations registration on registration.organization_id=decision.organization_id
    and registration.tryout_id=decision.tryout_id and registration.id=decision.registration_id
  join public.athletes athlete on athlete.organization_id=registration.organization_id and athlete.id=registration.athlete_id
  left join public.roster_assignments assignment on assignment.organization_id=decision.organization_id
    and assignment.roster_version_id=decision.roster_version_id and assignment.registration_id=decision.registration_id
  left join public.tryout_teams team on team.organization_id=assignment.organization_id and team.id=assignment.team_id
  where decision.organization_id=p_organization_id and decision.tryout_id=p_tryout_id
    and decision.division_id=p_division_id and decision.roster_version_id=p_roster_version_id
  order by decision.registration_id;
  if (select count(*) from private.roster_report_snapshot_items where roster_version_id=p_roster_version_id)<>captured then
    raise exception 'roster report snapshot capture mismatch' using errcode='55000';
  end if;
end;
$$;

create or replace function public.finalize_roster_version(
  p_organization_id uuid,p_tryout_id uuid,p_division_id uuid,p_roster_version_id uuid,
  p_expected_version bigint,p_confirmation text
) returns table(outcome text,version bigint)
language plpgsql security definer set search_path='' as $$
declare roster public.roster_versions%rowtype; finalized_time timestamptz;
begin
  if p_organization_id is null or p_tryout_id is null or p_division_id is null or p_roster_version_id is null
    or p_expected_version is null or p_expected_version<1 or not private.lock_and_can_manage_roster(p_organization_id,p_tryout_id,p_division_id)
  then return query select 'forbidden',null::bigint; return; end if;
  if p_confirmation is distinct from 'FINALIZE ROSTER' then return query select 'confirmation_required',null::bigint; return; end if;
  select * into roster from public.roster_versions where organization_id=p_organization_id and tryout_id=p_tryout_id and division_id=p_division_id and id=p_roster_version_id for update;
  if not found then return query select 'invalid_roster',null::bigint; return; end if;
  if roster.state<>'draft' then return query select 'invalid_state',roster.version; return; end if;
  if roster.version<>p_expected_version then return query select 'conflict',roster.version; return; end if;
  finalized_time:=clock_timestamp();
  perform private.capture_roster_report_snapshot(p_organization_id,p_tryout_id,p_division_id,p_roster_version_id,finalized_time);
  update public.roster_versions set state='finalized',version=roster_versions.version+1,
    finalized_by_user_id=auth.uid(),finalized_at=finalized_time
    where id=p_roster_version_id returning roster_versions.version into roster.version;
  insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id)
    values(p_organization_id,auth.uid(),'roster.finalized','roster_version',p_roster_version_id);
  return query select 'finalized',roster.version;
end;
$$;

create function private.calculate_report_evaluator_total(p_categories jsonb)
returns text language plpgsql immutable set search_path='' as $$
declare item jsonb; category_count integer; configured_weight numeric:=0; weighted_total numeric:=0;
declare weight_value numeric; score_value integer; scale_value integer; missing boolean:=false; category_ids text[]:='{}';
begin
  if jsonb_typeof(p_categories)<>'array' then raise exception 'report categories must be an array' using errcode='22023'; end if;
  category_count:=jsonb_array_length(p_categories);
  if category_count not between 1 and 100 then raise exception 'report category cardinality exceeds 100' using errcode='54000'; end if;
  for item in select value from jsonb_array_elements(p_categories) loop
    if jsonb_typeof(item)<>'object' or coalesce(item->>'categoryId','')='' or item->>'categoryId'=any(category_ids)
      or coalesce(item->>'weight','') !~ '^(?:0|[1-9][0-9]{0,2})(?:\.[0-9]{1,2})?$'
      or coalesce(item->>'scaleMax','') !~ '^(5|10)$'
    then raise exception 'invalid report category snapshot' using errcode='22023'; end if;
    category_ids:=array_append(category_ids,item->>'categoryId');
    weight_value:=(item->>'weight')::numeric;
    scale_value:=(item->>'scaleMax')::integer;
    if weight_value<=0 or weight_value>100 then raise exception 'invalid report category weight' using errcode='22023'; end if;
    configured_weight:=configured_weight+weight_value;
    if item->'score' is null or jsonb_typeof(item->'score')='null' then missing:=true; continue; end if;
    if (item->>'score') !~ '^[0-9]+$' then raise exception 'invalid report score' using errcode='22023'; end if;
    score_value:=(item->>'score')::integer;
    if score_value<1 or score_value>scale_value then raise exception 'invalid report score' using errcode='22023'; end if;
    weighted_total:=weighted_total+((score_value::numeric/scale_value::numeric)*100*weight_value);
  end loop;
  if configured_weight<>100 then raise exception 'report category weights must total 100' using errcode='22023'; end if;
  if missing then return null; end if;
  return to_char(round(weighted_total/configured_weight,4),'FM999990.0000');
end;
$$;

create function private.bounded_report_athlete_candidates(
  p_organization_id uuid,p_tryout_id uuid,p_max_rows integer
) returns table(athlete_id uuid,registration_id uuid)
language sql stable security definer set search_path='' as $$
  with candidates as materialized (
    select athlete.id
    from public.athletes athlete
    where athlete.organization_id=p_organization_id
      and (p_tryout_id is null or exists(select 1 from public.tryout_registrations registration
        where registration.organization_id=p_organization_id and registration.tryout_id=p_tryout_id
          and registration.athlete_id=athlete.id))
    order by athlete.id limit (p_max_rows+1)
  )
  select candidate.id,registration.id
  from candidates candidate
  left join lateral(
    select item.id from public.tryout_registrations item
    where item.organization_id=p_organization_id and item.athlete_id=candidate.id
      and (p_tryout_id is null or item.tryout_id=p_tryout_id)
    order by item.created_at desc,item.id desc limit 1
  ) registration on true
  order by candidate.id;
$$;

create function private.bounded_report_evaluation_candidates(
  p_organization_id uuid,p_tryout_id uuid,p_max_rows integer
) returns table(registration_id uuid,session_id uuid)
language sql stable security definer set search_path='' as $$
  select registration.id,enrollment.session_id
  from public.tryout_registrations registration
  join public.session_enrollments enrollment on enrollment.organization_id=registration.organization_id
    and enrollment.tryout_id=registration.tryout_id and enrollment.registration_id=registration.id
  where registration.organization_id=p_organization_id and registration.tryout_id=p_tryout_id
    and registration.status='submitted'
  order by registration.id,enrollment.session_id limit (p_max_rows+1);
$$;

revoke all on function private.prevent_roster_report_snapshot_mutation(),
  private.capture_roster_report_snapshot(uuid,uuid,uuid,uuid,timestamptz),
  private.calculate_report_evaluator_total(jsonb),
  private.bounded_report_athlete_candidates(uuid,uuid,integer),
  private.bounded_report_evaluation_candidates(uuid,uuid,integer)
from public,anon,authenticated,service_role;

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
    with candidates as materialized(select * from private.bounded_report_athlete_candidates(p_organization_id,p_tryout_id,p_max_rows)),
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

create or replace function public.load_report_summary(p_organization_id uuid,p_tryout_id uuid default null)
returns table(result jsonb)
language plpgsql stable security definer set search_path='' as $$
declare manager boolean; reviewer_roster uuid;
begin
  manager:=private.can_read_report_scope(p_organization_id,p_tryout_id)
    and (p_tryout_id is not null or public.is_active_organization_member(p_organization_id,array['owner','administrator']));
  if manager and (p_tryout_id is null or exists(select 1 from public.tryouts where organization_id=p_organization_id and id=p_tryout_id)) then
    return query select jsonb_build_object('outcome','ok','access','manager','summary',jsonb_build_object(
      'athleteCount',case when p_tryout_id is null then (select count(*) from public.athletes where organization_id=p_organization_id)
        else (select count(distinct athlete_id) from public.tryout_registrations where organization_id=p_organization_id and tryout_id=p_tryout_id) end,
      'completedEvaluationCount',(select count(*) from public.evaluations where organization_id=p_organization_id and (p_tryout_id is null or tryout_id=p_tryout_id) and state in ('completed','locked')),
      'incompleteEvaluationCount',(select count(*) from public.evaluations where organization_id=p_organization_id and (p_tryout_id is null or tryout_id=p_tryout_id) and state in ('draft','reopened')),
      'finalizedRosterCount',(select count(*) from public.roster_versions where organization_id=p_organization_id and (p_tryout_id is null or tryout_id=p_tryout_id) and state='finalized'),
      'latestFinalizedRosterId',(select id from public.roster_versions where organization_id=p_organization_id and (p_tryout_id is null or tryout_id=p_tryout_id) and state='finalized' order by finalized_at desc,id limit 1)
    )); return;
  end if;
  if p_tryout_id is not null and public.is_active_organization_member(p_organization_id) then
    select roster.id into reviewer_roster from public.roster_versions roster
    where roster.organization_id=p_organization_id and roster.tryout_id=p_tryout_id and roster.state='finalized'
      and private.can_read_roster(roster.organization_id,roster.tryout_id,roster.division_id,true)
      and exists(select 1 from private.roster_report_snapshots snapshot where snapshot.roster_version_id=roster.id)
    order by roster.finalized_at desc,roster.id limit 1;
  end if;
  if reviewer_roster is not null then
    return query select jsonb_build_object('outcome','ok','access','reviewer_roster','rosterVersionId',reviewer_roster); return;
  end if;
  return query select jsonb_build_object('outcome','forbidden');
end;
$$;
