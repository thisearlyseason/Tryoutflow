-- Reports are server-authorized projections. They deliberately expose a small,
-- bounded allow-list rather than granting callers table-shaped export access.

create function private.can_read_report_scope(p_organization_id uuid,p_tryout_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select auth.uid() is not null
    and public.is_active_organization_member(p_organization_id)
    and (
      public.is_active_organization_member(p_organization_id,array['owner','administrator'])
      or (p_tryout_id is not null and exists(
        select 1 from public.tryout_staff_assignments assignment
        where assignment.organization_id=p_organization_id
          and assignment.tryout_id=p_tryout_id
          and assignment.user_id=auth.uid()
          and assignment.role='director'
          and assignment.scope_kind='tryout'
          and assignment.revoked_at is null
          and (assignment.expires_at is null or assignment.expires_at>clock_timestamp())
      ))
    );
$$;
revoke all on function private.can_read_report_scope(uuid,uuid) from public,anon,authenticated,service_role;

create function public.load_report_export(
  p_organization_id uuid,
  p_export_type text,
  p_tryout_id uuid default null,
  p_roster_version_id uuid default null,
  p_max_rows integer default 5000
) returns table(result jsonb)
language plpgsql stable security definer set search_path='' as $$
declare
  target_roster public.roster_versions%rowtype;
  permitted boolean:=false;
  scope_label text;
  payload jsonb;
  total_rows bigint:=0;
begin
  if p_max_rows not between 1 and 5000 or p_export_type not in ('athletes','evaluations','roster') then
    return query select jsonb_build_object('outcome','forbidden'); return;
  end if;

  if p_export_type='athletes' then
    permitted:=case when p_tryout_id is null
      then public.is_active_organization_member(p_organization_id,array['owner','administrator'])
      else private.can_read_report_scope(p_organization_id,p_tryout_id) end;
  elsif p_export_type='evaluations' then
    permitted:=p_tryout_id is not null and private.can_read_report_scope(p_organization_id,p_tryout_id);
  else
    if p_tryout_id is null or p_roster_version_id is null then
      return query select jsonb_build_object('outcome','forbidden'); return;
    end if;
    select roster.* into target_roster from public.roster_versions roster
      where roster.organization_id=p_organization_id and roster.tryout_id=p_tryout_id
        and roster.id=p_roster_version_id;
    if not found then return query select jsonb_build_object('outcome','forbidden'); return; end if;
    if target_roster.state<>'finalized' then
      if private.can_read_roster(p_organization_id,p_tryout_id,target_roster.division_id,false) then
        return query select jsonb_build_object('outcome','not_finalized');
      else
        return query select jsonb_build_object('outcome','forbidden');
      end if;
      return;
    end if;
    permitted:=private.can_read_roster(p_organization_id,p_tryout_id,target_roster.division_id,true);
  end if;
  if not permitted then return query select jsonb_build_object('outcome','forbidden'); return; end if;
  if p_tryout_id is not null and not exists(select 1 from public.tryouts where organization_id=p_organization_id and id=p_tryout_id) then
    return query select jsonb_build_object('outcome','forbidden'); return;
  end if;

  select case when p_tryout_id is null then organization.name else organization.name||' - '||target.name end
    into scope_label from public.organizations organization
    left join public.tryouts target on target.organization_id=organization.id and target.id=p_tryout_id
    where organization.id=p_organization_id;
  if scope_label is null then return query select jsonb_build_object('outcome','forbidden'); return; end if;

  if p_export_type='athletes' then
    with source as materialized (
      select athlete.id,athlete.given_name,athlete.family_name,
        registration.id registration_id,registration.status,registration.position_id,
        position.name position_name,
        (select number.number from public.tryout_numbers number
          where number.organization_id=p_organization_id
            and (p_tryout_id is null or number.tryout_id=p_tryout_id)
            and number.registration_id=registration.id and number.released_at is null
          order by number.assigned_at desc,number.id limit 1) athlete_number
      from public.athletes athlete
      left join lateral (
        select candidate.* from public.tryout_registrations candidate
        where candidate.organization_id=athlete.organization_id and candidate.athlete_id=athlete.id
          and (p_tryout_id is null or candidate.tryout_id=p_tryout_id)
        order by candidate.created_at desc,candidate.id limit 1
      ) registration on true
      left join public.tryout_positions position on position.organization_id=p_organization_id
        and position.tryout_id=registration.tryout_id and position.id=registration.position_id
      where athlete.organization_id=p_organization_id
        and (p_tryout_id is null or registration.id is not null)
      order by athlete_number nulls last,athlete.id
      limit (p_max_rows + 1)
    ), bounded as (select * from source limit p_max_rows)
    select count(*),coalesce((select jsonb_agg(jsonb_build_object(
      'athleteNumber',bounded.athlete_number,'preferredName',bounded.given_name,
      'familyName',bounded.family_name,'position',bounded.position_name,
      'registrationStatus',coalesce(bounded.status,'cancelled'))
      order by bounded.athlete_number nulls last,bounded.id) from bounded),'[]'::jsonb)
      into total_rows,payload from source;
    return query select jsonb_build_object('outcome','ok','exportType','athletes','scopeLabel',scope_label,
      'rows',payload,'truncated',total_rows>p_max_rows); return;
  end if;

  if p_export_type='evaluations' then
    with source as materialized (
      select registration.id,session.id session_id,athlete.given_name,session.name session_name,
        (select number.number from public.tryout_numbers number
          where number.organization_id=p_organization_id and number.tryout_id=p_tryout_id
            and number.registration_id=registration.id and number.released_at is null
          order by number.assigned_at desc,number.id limit 1) athlete_number,
        case when count(evaluation.id)=0 then 'not_started'
          when bool_or(evaluation.state in ('draft','reopened')) then 'draft'
          when bool_or(evaluation.state='completed') then 'completed' else 'locked' end completion_state,
        case when count(score.id) filter(where evaluation.state in ('completed','locked'))=0 then null
          else trim(to_char(round(avg((score.value::numeric/category.scale_max::numeric)*100)
            filter(where evaluation.state in ('completed','locked')),1),'FM999990.0')) end overall_score
      from public.tryout_registrations registration
      join public.athletes athlete on athlete.organization_id=registration.organization_id and athlete.id=registration.athlete_id
      join public.session_enrollments enrollment on enrollment.organization_id=registration.organization_id
        and enrollment.tryout_id=registration.tryout_id and enrollment.registration_id=registration.id
      join public.tryout_sessions session on session.organization_id=enrollment.organization_id
        and session.tryout_id=enrollment.tryout_id and session.id=enrollment.session_id
      left join public.evaluations evaluation on evaluation.organization_id=registration.organization_id
        and evaluation.tryout_id=registration.tryout_id and evaluation.tryout_registration_id=registration.id
        and evaluation.tryout_session_id=session.id
      left join public.evaluation_scores score on score.organization_id=evaluation.organization_id and score.evaluation_id=evaluation.id
      left join public.rubric_categories category on category.organization_id=score.organization_id
        and category.tryout_id=score.tryout_id and category.rubric_version_id=score.rubric_version_id
        and category.id=score.rubric_category_id
      where registration.organization_id=p_organization_id and registration.tryout_id=p_tryout_id
        and registration.status='submitted'
      group by registration.id,session.id,athlete.given_name,session.name
      order by athlete_number nulls last,registration.id,session.id
      limit (p_max_rows + 1)
    ), bounded as (select * from source limit p_max_rows)
    select count(*),coalesce((select jsonb_agg(jsonb_build_object(
      'athleteNumber',bounded.athlete_number,'preferredName',bounded.given_name,
      'session',bounded.session_name,'completionState',bounded.completion_state,
      'overallScore',bounded.overall_score)
      order by bounded.athlete_number nulls last,bounded.id,bounded.session_id) from bounded),'[]'::jsonb)
      into total_rows,payload from source;
    return query select jsonb_build_object('outcome','ok','exportType','evaluations','scopeLabel',scope_label,
      'rows',payload,'truncated',total_rows>p_max_rows); return;
  end if;

  with source as materialized (
    select decision.registration_id,athlete.given_name,decision.status,team.name team_name,
      (select number.number from public.tryout_numbers number
        where number.organization_id=p_organization_id and number.tryout_id=p_tryout_id
          and number.registration_id=decision.registration_id and number.released_at is null
        order by number.assigned_at desc,number.id limit 1) athlete_number
    from public.roster_decisions decision
    join public.tryout_registrations registration on registration.organization_id=decision.organization_id
      and registration.tryout_id=decision.tryout_id and registration.id=decision.registration_id
    join public.athletes athlete on athlete.organization_id=registration.organization_id and athlete.id=registration.athlete_id
    left join public.roster_assignments assignment on assignment.organization_id=decision.organization_id
      and assignment.roster_version_id=decision.roster_version_id and assignment.registration_id=decision.registration_id
    left join public.tryout_teams team on team.organization_id=assignment.organization_id and team.id=assignment.team_id
    where decision.organization_id=p_organization_id and decision.tryout_id=p_tryout_id
      and decision.roster_version_id=p_roster_version_id
    order by athlete_number nulls last,decision.registration_id
    limit (p_max_rows + 1)
  ), bounded as (select * from source limit p_max_rows)
  select count(*),coalesce((select jsonb_agg(jsonb_build_object(
    'athleteNumber',bounded.athlete_number,'preferredName',bounded.given_name,
    'decision',bounded.status,'team',bounded.team_name)
    order by bounded.athlete_number nulls last,bounded.registration_id) from bounded),'[]'::jsonb)
    into total_rows,payload from source;
  return query select jsonb_build_object('outcome','ok','exportType','roster','scopeLabel',scope_label,
    'snapshot',jsonb_build_object('rosterVersionId',target_roster.id,'state',target_roster.state,
      'finalizedAt',to_char(target_roster.finalized_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'rows',payload),
    'truncated',total_rows>p_max_rows);
end;
$$;

create function public.load_report_summary(p_organization_id uuid,p_tryout_id uuid default null)
returns table(result jsonb)
language plpgsql stable security definer set search_path='' as $$
begin
  if not private.can_read_report_scope(p_organization_id,p_tryout_id)
    or (p_tryout_id is null and not public.is_active_organization_member(p_organization_id,array['owner','administrator']))
    or (p_tryout_id is not null and not exists(select 1 from public.tryouts where organization_id=p_organization_id and id=p_tryout_id)) then
    return query select jsonb_build_object('outcome','forbidden'); return;
  end if;
  return query select jsonb_build_object('outcome','ok','summary',jsonb_build_object(
    'athleteCount',(select count(distinct athlete_id) from public.tryout_registrations where organization_id=p_organization_id and (p_tryout_id is null or tryout_id=p_tryout_id)),
    'completedEvaluationCount',(select count(*) from public.evaluations where organization_id=p_organization_id and (p_tryout_id is null or tryout_id=p_tryout_id) and state in ('completed','locked')),
    'incompleteEvaluationCount',(select count(*) from public.evaluations where organization_id=p_organization_id and (p_tryout_id is null or tryout_id=p_tryout_id) and state in ('draft','reopened')),
    'finalizedRosterCount',(select count(*) from public.roster_versions where organization_id=p_organization_id and (p_tryout_id is null or tryout_id=p_tryout_id) and state='finalized'),
    'latestFinalizedRosterId',(select id from public.roster_versions where organization_id=p_organization_id and (p_tryout_id is null or tryout_id=p_tryout_id) and state='finalized' order by finalized_at desc,id limit 1)
  ));
end;
$$;

create function public.load_onboarding_facts(p_organization_id uuid)
returns table(result jsonb)
language plpgsql stable security definer set search_path='' as $$
begin
  if not public.is_active_organization_member(p_organization_id) then
    return query select jsonb_build_object('outcome','forbidden'); return;
  end if;
  return query select jsonb_build_object('outcome','ok','facts',jsonb_build_object(
    'organizationExists',exists(select 1 from public.organizations where id=p_organization_id),
    'settingsConfigured',exists(select 1 from public.organizations where id=p_organization_id
      and timezone<>'' and terminology ? 'athlete' and jsonb_array_length(sport_defaults)>0),
    'registrationConfigured',exists(select 1 from public.registration_form_versions where organization_id=p_organization_id and status='published'),
    'activeStaffCount',(select count(*) from public.tryout_staff_assignments where organization_id=p_organization_id and revoked_at is null and (expires_at is null or expires_at>clock_timestamp())),
    'publishedRubricCount',(select count(*) from public.rubric_versions where organization_id=p_organization_id and status='published'),
    'sessionCount',(select count(*) from public.tryout_sessions where organization_id=p_organization_id),
    'completedEvaluationCount',(select count(*) from public.evaluations where organization_id=p_organization_id and state in ('completed','locked')),
    'finalizedRosterCount',(select count(*) from public.roster_versions where organization_id=p_organization_id and state='finalized')
  ));
end;
$$;

revoke all on function public.load_report_export(uuid,text,uuid,uuid,integer) from public,anon,service_role;
revoke all on function public.load_report_summary(uuid,uuid) from public,anon,service_role;
revoke all on function public.load_onboarding_facts(uuid) from public,anon,service_role;
grant execute on function public.load_report_export(uuid,text,uuid,uuid,integer) to authenticated;
grant execute on function public.load_report_summary(uuid,uuid) to authenticated;
grant execute on function public.load_onboarding_facts(uuid) to authenticated;
