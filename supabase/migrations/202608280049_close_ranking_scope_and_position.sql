-- Every ranking/live projection is derived from the exact enrollment placements
-- the current actor may read. A registration visible in one placement never
-- authorizes sibling sessions or groups.

create or replace function public.load_ranking_snapshot(
  p_organization_id uuid,p_tryout_id uuid,p_division_id uuid default null,
  p_position_id uuid default null,p_session_id uuid default null,p_group_id uuid default null,
  p_athlete_ids uuid[] default null
) returns table(result jsonb)
language plpgsql stable security definer set search_path='' as $$
declare broad_manager boolean;
declare scope_valid boolean;
declare authorized_athlete_count integer;
begin
  broad_manager:=auth.uid() is not null
    and public.is_active_organization_member(p_organization_id,array['owner','administrator']);
  if auth.uid() is null or not public.is_active_organization_member(p_organization_id) then
    return query select jsonb_build_object('outcome','forbidden'); return;
  end if;
  if p_athlete_ids is not null and (cardinality(p_athlete_ids) not between 2 and 4
    or cardinality(p_athlete_ids)<>(select count(distinct value) from unnest(p_athlete_ids) value)) then
    return query select jsonb_build_object('outcome','forbidden'); return;
  end if;
  if not broad_manager and not exists(
    select 1 from public.tryout_staff_assignments assignment
    where assignment.organization_id=p_organization_id and assignment.tryout_id=p_tryout_id
      and assignment.user_id=auth.uid() and assignment.role in ('director','reviewer')
      and assignment.revoked_at is null
      and (assignment.expires_at is null or assignment.expires_at>clock_timestamp())
      and (assignment.role='director' or exists(
        select 1 from public.tryouts target where target.organization_id=p_organization_id
          and target.id=p_tryout_id and target.status='finalized'))
  ) then return query select jsonb_build_object('outcome','forbidden'); return; end if;

  scope_valid:=exists(select 1 from public.tryouts target where target.organization_id=p_organization_id and target.id=p_tryout_id)
    and (p_division_id is null or exists(select 1 from public.tryout_divisions division where division.organization_id=p_organization_id and division.tryout_id=p_tryout_id and division.id=p_division_id))
    and (p_position_id is null or exists(select 1 from public.tryout_positions position where position.organization_id=p_organization_id and position.tryout_id=p_tryout_id and position.id=p_position_id))
    and (p_session_id is null or exists(select 1 from public.tryout_sessions session where session.organization_id=p_organization_id and session.tryout_id=p_tryout_id and session.id=p_session_id and (p_division_id is null or session.division_id=p_division_id)))
    and (p_group_id is null or (p_session_id is not null and exists(select 1 from public.session_groups grouping where grouping.organization_id=p_organization_id and grouping.tryout_id=p_tryout_id and grouping.session_id=p_session_id and grouping.id=p_group_id)));
  if not scope_valid then
    return query select jsonb_build_object('outcome',case when broad_manager then 'invalid_scope' else 'forbidden' end); return;
  end if;

  if p_athlete_ids is not null then
    select count(distinct registration.athlete_id) into authorized_athlete_count
    from public.tryout_registrations registration
    join public.session_enrollments enrollment
      on enrollment.organization_id=registration.organization_id and enrollment.tryout_id=registration.tryout_id
      and enrollment.registration_id=registration.id
    where registration.organization_id=p_organization_id and registration.tryout_id=p_tryout_id
      and registration.status='submitted' and registration.athlete_id=any(p_athlete_ids)
      and private.can_read_ranking_registration(registration.organization_id,registration.tryout_id,
        registration.division_id,enrollment.session_id,enrollment.group_id,registration.athlete_id);
    if authorized_athlete_count<>cardinality(p_athlete_ids) then
      return query select jsonb_build_object('outcome','forbidden'); return;
    end if;
  end if;

  -- A narrow actor never receives a different empty-vs-invalid signal for a
  -- real but unauthorized identifier. Explicit scope filters must resolve to
  -- at least one placement the actor can actually read.
  if not broad_manager and (p_division_id is not null or p_position_id is not null or p_session_id is not null or p_group_id is not null)
    and not exists(
      select 1 from public.tryout_registrations registration
      join public.session_enrollments enrollment on enrollment.organization_id=registration.organization_id and enrollment.tryout_id=registration.tryout_id and enrollment.registration_id=registration.id
      where registration.organization_id=p_organization_id and registration.tryout_id=p_tryout_id and registration.status='submitted'
        and (p_division_id is null or registration.division_id=p_division_id)
        and (p_position_id is null or registration.position_id=p_position_id)
        and (p_session_id is null or enrollment.session_id=p_session_id)
        and (p_group_id is null or enrollment.group_id=p_group_id)
        and private.can_read_ranking_registration(registration.organization_id,registration.tryout_id,registration.division_id,enrollment.session_id,enrollment.group_id,registration.athlete_id)
    ) then
    return query select jsonb_build_object('outcome','forbidden'); return;
  end if;

  return query
  with authorized_enrollments as materialized (
    select registration.id registration_id,registration.athlete_id,registration.division_id,
      registration.position_id,enrollment.session_id,enrollment.group_id,
      session.name session_name,grouping.name group_name
    from public.tryout_registrations registration
    join public.session_enrollments enrollment
      on enrollment.organization_id=registration.organization_id and enrollment.tryout_id=registration.tryout_id
      and enrollment.registration_id=registration.id
    join public.tryout_sessions session
      on session.organization_id=enrollment.organization_id and session.tryout_id=enrollment.tryout_id
      and session.id=enrollment.session_id and session.division_id=registration.division_id
    left join public.session_groups grouping
      on grouping.organization_id=enrollment.organization_id and grouping.tryout_id=enrollment.tryout_id
      and grouping.session_id=enrollment.session_id and grouping.id=enrollment.group_id
    where registration.organization_id=p_organization_id and registration.tryout_id=p_tryout_id
      and registration.status='submitted'
      and private.can_read_ranking_registration(registration.organization_id,registration.tryout_id,
        registration.division_id,enrollment.session_id,enrollment.group_id,registration.athlete_id)
    order by registration.id,enrollment.session_id limit 10000
  ), requested_enrollments as materialized (
    select * from authorized_enrollments placement
    where (p_division_id is null or placement.division_id=p_division_id)
      and (p_position_id is null or placement.position_id=p_position_id)
      and (p_session_id is null or placement.session_id=p_session_id)
      and (p_group_id is null or placement.group_id=p_group_id)
      and (p_athlete_ids is null or placement.athlete_id=any(p_athlete_ids))
  ), registrations as materialized (
    select distinct registration.*,athlete.given_name||' '||athlete.family_name display_name,
      division.name division_name,position.name position_name
    from public.tryout_registrations registration
    join requested_enrollments placement on placement.registration_id=registration.id
    join public.athletes athlete on athlete.organization_id=registration.organization_id and athlete.id=registration.athlete_id
    join public.tryout_divisions division on division.organization_id=registration.organization_id and division.tryout_id=registration.tryout_id and division.id=registration.division_id
    left join public.tryout_positions position on position.organization_id=registration.organization_id and position.tryout_id=registration.tryout_id and position.id=registration.position_id
    order by registration.id limit 10000
  ), filter_options as (
    select jsonb_build_object(
      'divisions',coalesce((select jsonb_agg(jsonb_build_object('id',item.id,'name',item.name) order by item.sort_order,item.id) from (select distinct division.id,division.name,division.sort_order from authorized_enrollments placement join public.tryout_divisions division on division.organization_id=p_organization_id and division.tryout_id=p_tryout_id and division.id=placement.division_id order by division.sort_order,division.id limit 100) item),'[]'::jsonb),
      'positions',coalesce((select jsonb_agg(jsonb_build_object('id',item.id,'name',item.name) order by item.sort_order,item.id) from (select distinct position.id,position.name,position.sort_order from authorized_enrollments placement join public.tryout_positions position on position.organization_id=p_organization_id and position.tryout_id=p_tryout_id and position.id=placement.position_id order by position.sort_order,position.id limit 100) item),'[]'::jsonb),
      'sessions',coalesce((select jsonb_agg(jsonb_build_object('id',item.session_id,'name',item.session_name) order by item.session_id) from (select distinct session_id,session_name from authorized_enrollments order by session_id limit 100) item),'[]'::jsonb),
      'groups',coalesce((select jsonb_agg(jsonb_build_object('id',item.group_id,'name',item.group_name) order by item.group_id) from (select distinct group_id,group_name from authorized_enrollments where group_id is not null order by group_id limit 500) item),'[]'::jsonb)
    ) value
  )
  select jsonb_build_object('outcome','ok','snapshot',jsonb_build_object(
    'generatedAt',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'filterOptions',(select value from filter_options),
    'registrations',coalesce(jsonb_agg(jsonb_build_object(
      'registrationId',registration.id,'athleteId',registration.athlete_id,'displayName',registration.display_name,
      'divisionId',registration.division_id,'divisionName',registration.division_name,
      'positionId',registration.position_id,'positionName',registration.position_name,
      'tryoutNumber',(select number.number from public.tryout_numbers number
        where number.organization_id=registration.organization_id and number.tryout_id=registration.tryout_id
          and number.registration_id=registration.id and number.released_at is null
          and (number.scope_kind in ('tryout','division') or exists(select 1 from requested_enrollments placement where placement.registration_id=registration.id and placement.session_id=number.session_id and (number.scope_kind='session' or placement.group_id=number.group_id)))
        order by case number.scope_kind when 'group' then 1 when 'session' then 2 when 'division' then 3 else 4 end,number.assigned_at desc limit 1),
      'expectedEvaluators',(select count(*) from (select distinct placement.session_id,staff.user_id
        from requested_enrollments placement join public.tryout_staff_assignments staff
          on staff.organization_id=p_organization_id and staff.tryout_id=p_tryout_id and staff.role='evaluator'
        join public.organization_members member on member.organization_id=staff.organization_id and member.user_id=staff.user_id and member.status='active'
        where placement.registration_id=registration.id and staff.revoked_at is null and (staff.expires_at is null or staff.expires_at>clock_timestamp())
          and (staff.scope_kind='tryout' or (staff.scope_kind='division' and staff.division_id=placement.division_id) or (staff.scope_kind='session' and staff.session_id=placement.session_id) or (staff.scope_kind='group' and staff.session_id=placement.session_id and staff.group_id=placement.group_id) or (staff.scope_kind='athlete' and staff.athlete_id=placement.athlete_id))) expected),
      'evaluations',coalesce((select jsonb_agg(jsonb_build_object(
        'evaluationId',evaluation.id,'evaluatorId',evaluation.id,'divisionId',evaluation.division_id,
        'sessionId',evaluation.tryout_session_id,'groupId',evaluation.group_id,'state',evaluation.state,'assignmentState','active',
        'categories',coalesce((select jsonb_agg(jsonb_build_object('categoryId',category.id,'categoryName',category.name,'score',score.value,'scaleMax',category.scale_max,'weight',category.weight::text,'isPriority',category.is_priority) order by category.sort_order,category.id)
          from public.rubric_categories category join public.evaluation_scores score on score.organization_id=category.organization_id and score.tryout_id=category.tryout_id and score.rubric_version_id=category.rubric_version_id and score.rubric_category_id=category.id and score.evaluation_id=evaluation.id
          where category.organization_id=evaluation.organization_id and category.tryout_id=evaluation.tryout_id and category.rubric_version_id=evaluation.rubric_version_id),'[]'::jsonb)) order by evaluation.tryout_session_id,evaluation.id)
        from public.evaluations evaluation
        join requested_enrollments placement on placement.registration_id=evaluation.tryout_registration_id and placement.session_id=evaluation.tryout_session_id and placement.group_id is not distinct from evaluation.group_id
        join public.organization_members member on member.organization_id=evaluation.organization_id and member.user_id=evaluation.evaluator_user_id and member.status='active'
        join public.rubric_versions rubric on rubric.organization_id=evaluation.organization_id and rubric.tryout_id=evaluation.tryout_id and rubric.id=evaluation.rubric_version_id and rubric.status='published'
        join public.session_rubrics binding on binding.organization_id=evaluation.organization_id and binding.tryout_id=evaluation.tryout_id and binding.session_id=evaluation.tryout_session_id and binding.rubric_version_id=evaluation.rubric_version_id
        where evaluation.organization_id=registration.organization_id and evaluation.tryout_id=registration.tryout_id and evaluation.tryout_registration_id=registration.id and evaluation.state in ('completed','locked')
          and exists(select 1 from public.tryout_staff_assignments staff where staff.organization_id=evaluation.organization_id and staff.tryout_id=evaluation.tryout_id and staff.user_id=evaluation.evaluator_user_id and staff.role='evaluator' and staff.revoked_at is null and (staff.expires_at is null or staff.expires_at>clock_timestamp()) and (staff.scope_kind='tryout' or (staff.scope_kind='division' and staff.division_id=evaluation.division_id) or (staff.scope_kind='session' and staff.session_id=evaluation.tryout_session_id) or (staff.scope_kind='group' and staff.session_id=evaluation.tryout_session_id and staff.group_id=evaluation.group_id) or (staff.scope_kind='athlete' and staff.athlete_id=registration.athlete_id)))),'[]'::jsonb),
      'categoryNames',coalesce((select jsonb_agg(jsonb_build_object('id',item.id,'name',item.name,'scaleMax',item.scale_max) order by item.id) from (select distinct category.id,category.name,category.scale_max from requested_enrollments placement join public.session_rubrics binding on binding.organization_id=p_organization_id and binding.tryout_id=p_tryout_id and binding.session_id=placement.session_id join public.rubric_categories category on category.organization_id=binding.organization_id and category.tryout_id=binding.tryout_id and category.rubric_version_id=binding.rubric_version_id where placement.registration_id=registration.id order by category.id limit 100) item),'[]'::jsonb),
      'sessions',coalesce((select jsonb_agg(jsonb_build_object('id',item.session_id,'name',item.session_name,'expectedEvaluators',item.expected_evaluators) order by item.session_id) from (select placement.session_id,placement.session_name,(select count(distinct staff.user_id) from public.tryout_staff_assignments staff join public.organization_members member on member.organization_id=staff.organization_id and member.user_id=staff.user_id and member.status='active' where staff.organization_id=p_organization_id and staff.tryout_id=p_tryout_id and staff.role='evaluator' and staff.revoked_at is null and (staff.expires_at is null or staff.expires_at>clock_timestamp()) and (staff.scope_kind='tryout' or (staff.scope_kind='division' and staff.division_id=placement.division_id) or (staff.scope_kind='session' and staff.session_id=placement.session_id) or (staff.scope_kind='group' and staff.session_id=placement.session_id and staff.group_id=placement.group_id) or (staff.scope_kind='athlete' and staff.athlete_id=placement.athlete_id))) expected_evaluators from requested_enrollments placement where placement.registration_id=registration.id order by placement.session_id limit 100) item),'[]'::jsonb),
      'groups',coalesce((select jsonb_agg(jsonb_build_object('id',item.group_id,'name',item.group_name) order by item.group_id) from (select distinct placement.group_id,placement.group_name from requested_enrollments placement where placement.registration_id=registration.id and placement.group_id is not null order by placement.group_id limit 500) item),'[]'::jsonb),
      'flags',coalesce((select jsonb_agg(item.flag_type order by item.flag_type) from (select distinct flag.flag_type from public.athlete_flags flag join requested_enrollments placement on placement.registration_id=flag.tryout_registration_id and placement.session_id=flag.tryout_session_id and placement.group_id is not distinct from flag.group_id where flag.organization_id=registration.organization_id and flag.tryout_id=registration.tryout_id and flag.tryout_registration_id=registration.id and flag.revoked_at is null and flag.creator_kind='director') item),'[]'::jsonb)
    ) order by registration.id),'[]'::jsonb)
  )) from registrations registration;
end;
$$;

create or replace function public.load_live_dashboard(
  p_organization_id uuid,p_tryout_id uuid,p_division_id uuid default null,
  p_session_id uuid default null,p_group_id uuid default null
) returns table(result jsonb)
language plpgsql stable security definer set search_path='' as $$
declare broad_manager boolean;
begin
  broad_manager:=auth.uid() is not null and public.is_active_organization_member(p_organization_id,array['owner','administrator']);
  if auth.uid() is null or not public.is_active_organization_member(p_organization_id) or (not broad_manager and not exists(select 1 from public.tryout_staff_assignments assignment where assignment.organization_id=p_organization_id and assignment.tryout_id=p_tryout_id and assignment.user_id=auth.uid() and assignment.role='director' and assignment.revoked_at is null and (assignment.expires_at is null or assignment.expires_at>clock_timestamp()))) then
    return query select jsonb_build_object('outcome','forbidden'); return;
  end if;
  if not exists(select 1 from public.tryouts target where target.organization_id=p_organization_id and target.id=p_tryout_id)
    or (p_division_id is not null and not exists(select 1 from public.tryout_divisions division where division.organization_id=p_organization_id and division.tryout_id=p_tryout_id and division.id=p_division_id))
    or (p_session_id is not null and not exists(select 1 from public.tryout_sessions session where session.organization_id=p_organization_id and session.tryout_id=p_tryout_id and session.id=p_session_id and (p_division_id is null or session.division_id=p_division_id)))
    or (p_group_id is not null and (p_session_id is null or not exists(select 1 from public.session_groups grouping where grouping.organization_id=p_organization_id and grouping.tryout_id=p_tryout_id and grouping.session_id=p_session_id and grouping.id=p_group_id))) then
    return query select jsonb_build_object('outcome',case when broad_manager then 'invalid_scope' else 'forbidden' end); return;
  end if;
  if not broad_manager and (p_division_id is not null or p_session_id is not null or p_group_id is not null)
    and not exists(select 1 from public.tryout_registrations registration join public.session_enrollments enrollment on enrollment.organization_id=registration.organization_id and enrollment.tryout_id=registration.tryout_id and enrollment.registration_id=registration.id where registration.organization_id=p_organization_id and registration.tryout_id=p_tryout_id and registration.status='submitted' and (p_division_id is null or registration.division_id=p_division_id) and (p_session_id is null or enrollment.session_id=p_session_id) and (p_group_id is null or enrollment.group_id=p_group_id) and private.can_read_live_registration(registration.organization_id,registration.tryout_id,registration.division_id,enrollment.session_id,enrollment.group_id,registration.athlete_id)) then
    return query select jsonb_build_object('outcome','forbidden'); return;
  end if;
  return query with eligible as materialized (
    select distinct registration.id,registration.athlete_id,registration.division_id,enrollment.session_id,enrollment.group_id
    from public.tryout_registrations registration join public.session_enrollments enrollment on enrollment.organization_id=registration.organization_id and enrollment.tryout_id=registration.tryout_id and enrollment.registration_id=registration.id
    where registration.organization_id=p_organization_id and registration.tryout_id=p_tryout_id and registration.status='submitted'
      and (p_division_id is null or registration.division_id=p_division_id) and (p_session_id is null or enrollment.session_id=p_session_id) and (p_group_id is null or enrollment.group_id=p_group_id)
      and private.can_read_live_registration(registration.organization_id,registration.tryout_id,registration.division_id,enrollment.session_id,enrollment.group_id,registration.athlete_id)
  ), expected as materialized (
    select distinct eligible.id,eligible.session_id,staff.user_id from eligible join public.tryout_staff_assignments staff on staff.organization_id=p_organization_id and staff.tryout_id=p_tryout_id and staff.role='evaluator' join public.organization_members member on member.organization_id=staff.organization_id and member.user_id=staff.user_id and member.status='active'
    where staff.revoked_at is null and (staff.expires_at is null or staff.expires_at>clock_timestamp()) and (staff.scope_kind='tryout' or (staff.scope_kind='division' and staff.division_id=eligible.division_id) or (staff.scope_kind='session' and staff.session_id=eligible.session_id) or (staff.scope_kind='group' and staff.session_id=eligible.session_id and staff.group_id=eligible.group_id) or (staff.scope_kind='athlete' and staff.athlete_id=eligible.athlete_id))
  ) select jsonb_build_object('outcome','ok','dashboard',jsonb_build_object(
    'registrations',(select count(distinct id) from eligible),
    'checkedIn',(select count(distinct checkin.registration_id) from public.checkins checkin join eligible on eligible.id=checkin.registration_id and eligible.session_id=checkin.session_id and eligible.group_id is not distinct from checkin.group_id where checkin.reversed_at is null),
    'activeEvaluators',(select count(distinct user_id) from expected),
    'expectedEvaluations',(select count(*) from expected),
    'completedEvaluations',(select count(*) from public.evaluations evaluation join expected on expected.id=evaluation.tryout_registration_id and expected.session_id=evaluation.tryout_session_id and expected.user_id=evaluation.evaluator_user_id where evaluation.state in ('completed','locked')),
    'recordedSyncExceptions',(select count(*) from public.evaluation_mutations mutation join public.evaluations evaluation on evaluation.organization_id=mutation.organization_id and evaluation.id=mutation.evaluation_id join eligible on eligible.id=evaluation.tryout_registration_id and eligible.session_id=evaluation.tryout_session_id and eligible.group_id is not distinct from evaluation.group_id where mutation.outcome<>'synced'),
    'generatedAt',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')));
end;
$$;

-- Public configuration exposes only published display labels and opaque IDs.
create function public.public_registration_tryout_v2(p_tryout_slug text)
returns table(tryout_id uuid,name text,slug text,form_schema jsonb,divisions jsonb,positions jsonb)
language sql stable security definer set search_path='' as $$
  select target.id,target.name,target.slug,version.schema,
    coalesce((select jsonb_agg(jsonb_build_object('id',division.id,'name',division.name) order by division.sort_order,division.id) from public.tryout_divisions division where division.organization_id=target.organization_id and division.tryout_id=target.id),'[]'::jsonb),
    coalesce((select jsonb_agg(jsonb_build_object('id',position.id,'name',position.name) order by position.sort_order,position.id) from public.tryout_positions position where position.organization_id=target.organization_id and position.tryout_id=target.id),'[]'::jsonb)
  from public.tryouts target join public.tryout_registration_form_selections selection on selection.organization_id=target.organization_id and selection.tryout_id=target.id join public.registration_form_versions version on version.organization_id=selection.organization_id and version.tryout_id=selection.tryout_id and version.id=selection.registration_form_version_id and version.status='published'
  where target.slug=p_tryout_slug and target.status='published' and target.registration_starts_at<=clock_timestamp() and target.registration_ends_at>clock_timestamp();
$$;

create function public.submit_public_registration_with_position(p_tryout_slug text,p_submission jsonb,p_idempotency_key text,p_rate_key_hash text,p_position_id uuid default null)
returns table(outcome text,registration_id uuid,confirmation_token text)
language plpgsql security definer set search_path='' as $$
declare result_row record; target_tryout uuid; target_organization uuid; stored_position uuid; existing_registration uuid; valid_key text;
begin
  select target.id,target.organization_id into target_tryout,target_organization from public.tryouts target where target.slug=p_tryout_slug and target.status='published' and target.registration_starts_at<=clock_timestamp() and target.registration_ends_at>clock_timestamp();
  if not found or (p_position_id is not null and not exists(select 1 from public.tryout_positions position where position.organization_id=target_organization and position.tryout_id=target_tryout and position.id=p_position_id)) then
    return query select 'registration_closed'::text,null::uuid,null::text; return;
  end if;
  -- Serialize before checking the position fence. The legacy command takes the
  -- same transaction-scoped lock, so a concurrent replay cannot rotate a token
  -- or update contact data before a changed-position conflict is detected.
  perform pg_advisory_xact_lock(hashtextextended(target_tryout::text||':'||p_idempotency_key,0));
  valid_key:=encode(extensions.digest(p_idempotency_key,'sha256'),'hex');
  select registration.id,registration.position_id into existing_registration,stored_position
  from public.tryout_registrations registration
  where registration.organization_id=target_organization and registration.tryout_id=target_tryout
    and registration.submission_key_digest=valid_key;
  if found and stored_position is distinct from p_position_id then
    return query select 'idempotency_conflict'::text,null::uuid,null::text; return;
  end if;
  select * into result_row from public.submit_public_registration_with_phone(p_tryout_slug,p_submission-'positionId',p_idempotency_key,p_rate_key_hash);
  if result_row.outcome not in ('submitted','replayed') then return query select result_row.outcome,result_row.registration_id,result_row.confirmation_token; return; end if;
  select position_id into stored_position from public.tryout_registrations where organization_id=target_organization and tryout_id=target_tryout and id=result_row.registration_id for update;
  if result_row.outcome='replayed' and stored_position is distinct from p_position_id then
    return query select 'idempotency_conflict'::text,null::uuid,null::text; return;
  end if;
  update public.tryout_registrations set position_id=p_position_id where organization_id=target_organization and tryout_id=target_tryout and id=result_row.registration_id;
  return query select result_row.outcome,result_row.registration_id,result_row.confirmation_token;
end;
$$;

revoke all on function public.public_registration_tryout_v2(text),public.submit_public_registration_with_position(text,jsonb,text,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.public_registration_tryout_v2(text) to anon,authenticated,service_role;
grant execute on function public.submit_public_registration_with_position(text,jsonb,text,text,uuid) to service_role;
