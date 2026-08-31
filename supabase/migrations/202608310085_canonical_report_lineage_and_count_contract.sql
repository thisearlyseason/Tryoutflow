-- Tryout-scoped athlete exports must bound directly from registrations.  This
-- index supplies both DISTINCT ON's latest-registration choice and its stable
-- athlete ordering before the candidate cap, without sorting all tenant rows.
create index if not exists tryout_registrations_report_tryout_athlete_latest_idx
  on public.tryout_registrations(
    organization_id,tryout_id,athlete_id,created_at desc,id desc
  );

create or replace function private.bounded_report_athlete_candidates(
  p_organization_id uuid,p_tryout_id uuid,p_max_rows integer
) returns table(athlete_id uuid,registration_id uuid)
language sql stable security definer set search_path='' as $$
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
  ), tryout_candidates as materialized (
    select distinct on (registration.athlete_id)
      registration.athlete_id,registration.id registration_id
    from public.tryout_registrations registration
    where p_tryout_id is not null
      and registration.organization_id=p_organization_id
      and registration.tryout_id=p_tryout_id
    order by registration.athlete_id,registration.created_at desc,registration.id desc
    limit (p_max_rows+1)
  )
  select * from organization_candidates
  union all
  select * from tryout_candidates
  order by athlete_id;
$$;

-- A verified current roster does not erase the fact that a reviewer or
-- manager also has a legacy finalized revision with no downloadable snapshot.
create or replace function public.load_report_summary(p_organization_id uuid,p_tryout_id uuid default null)
returns table(result jsonb)
language plpgsql stable security definer set search_path='' as $$
declare manager boolean; reviewer_roster uuid; reviewer_legacy_count integer:=0;
begin
  manager:=private.can_read_report_scope(p_organization_id,p_tryout_id)
    and (p_tryout_id is not null or public.is_active_organization_member(p_organization_id,array['owner','administrator']));
  if manager and (p_tryout_id is null or exists(select 1 from public.tryouts where organization_id=p_organization_id and id=p_tryout_id)) then
    return query select jsonb_build_object('outcome','ok','access','manager','summary',jsonb_build_object(
      'athleteCount',case when p_tryout_id is null then (select count(*) from public.athletes where organization_id=p_organization_id)
        else (select count(distinct athlete_id) from public.tryout_registrations where organization_id=p_organization_id and tryout_id=p_tryout_id) end,
      'completedEvaluationCount',(select count(*) from public.evaluations evaluation join public.tryout_registrations registration
        on registration.organization_id=evaluation.organization_id and registration.id=evaluation.tryout_registration_id
        where evaluation.organization_id=p_organization_id and (p_tryout_id is null or evaluation.tryout_id=p_tryout_id)
          and registration.status='submitted' and evaluation.state in ('completed','locked')),
      'incompleteEvaluationCount',(select count(*) from public.evaluations evaluation join public.tryout_registrations registration
        on registration.organization_id=evaluation.organization_id and registration.id=evaluation.tryout_registration_id
        where evaluation.organization_id=p_organization_id and (p_tryout_id is null or evaluation.tryout_id=p_tryout_id)
          and registration.status='submitted' and evaluation.state in ('draft','reopened')),
      'finalizedRosterCount',(select count(*) from public.roster_versions where organization_id=p_organization_id and (p_tryout_id is null or tryout_id=p_tryout_id) and state='finalized'),
      'latestFinalizedRosterId',(select roster.id from public.roster_versions roster join private.roster_report_snapshots snapshot
        on snapshot.roster_version_id=roster.id where roster.organization_id=p_organization_id
          and (p_tryout_id is null or roster.tryout_id=p_tryout_id) and roster.state='finalized'
        order by roster.finalized_at desc,roster.id desc limit 1),
      'unavailableFinalizedRosterCount',(select count(*) from public.roster_versions roster left join private.roster_report_snapshots snapshot
        on snapshot.roster_version_id=roster.id where roster.organization_id=p_organization_id
          and (p_tryout_id is null or roster.tryout_id=p_tryout_id) and roster.state='finalized' and snapshot.roster_version_id is null)
    )); return;
  end if;
  if p_tryout_id is not null and public.is_active_organization_member(p_organization_id) then
    select roster.id into reviewer_roster from public.roster_versions roster
    join private.roster_report_snapshots snapshot on snapshot.roster_version_id=roster.id
    where roster.organization_id=p_organization_id and roster.tryout_id=p_tryout_id and roster.state='finalized'
      and private.can_read_roster(roster.organization_id,roster.tryout_id,roster.division_id,true)
    order by roster.finalized_at desc,roster.id desc limit 1;
    select count(*) into reviewer_legacy_count from public.roster_versions roster
      left join private.roster_report_snapshots snapshot on snapshot.roster_version_id=roster.id
      where roster.organization_id=p_organization_id and roster.tryout_id=p_tryout_id and roster.state='finalized'
        and private.can_read_roster(roster.organization_id,roster.tryout_id,roster.division_id,true)
        and snapshot.roster_version_id is null;
  end if;
  if reviewer_roster is not null then
    return query select jsonb_build_object('outcome','ok','access','reviewer_roster','rosterVersionId',reviewer_roster,
      'unavailableFinalizedRosterCount',reviewer_legacy_count); return;
  end if;
  if reviewer_legacy_count>0 then
    return query select jsonb_build_object('outcome','ok','access','reviewer_roster_unavailable'); return;
  end if;
  return query select jsonb_build_object('outcome','forbidden');
end;
$$;

revoke all on function private.bounded_report_athlete_candidates(uuid,uuid,integer)
from public,anon,authenticated,service_role;
