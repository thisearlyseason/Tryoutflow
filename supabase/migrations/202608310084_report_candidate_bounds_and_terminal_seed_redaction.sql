-- Keep report candidate work index-backed and bounded before the descriptive
-- report joins.  These indexes deliberately match the helper predicates and
-- stable ordering; a broad organization-only index is not sufficient.
create index if not exists tryout_registrations_report_latest_athlete_idx
  on public.tryout_registrations(organization_id,athlete_id,created_at desc,id desc);
create index if not exists tryout_registrations_report_submitted_order_idx
  on public.tryout_registrations(organization_id,tryout_id,id)
  where status='submitted';
create index if not exists session_enrollments_report_candidate_order_idx
  on public.session_enrollments(organization_id,tryout_id,registration_id,session_id);
create index if not exists evaluations_report_candidate_lifecycle_idx
  on public.evaluations(organization_id,tryout_id,tryout_registration_id,tryout_session_id,id);

-- Provider preview identifiers are sensitive terminal-fixture bytes.  Earlier
-- migrations made preview records nullable but retained the obsolete NOT NULL
-- contract on sync jobs, which prevented a redacted completed/failed fixture.
alter table public.integration_sync_jobs alter column provider_preview_id drop not null;

-- Upgrade an existing locally seeded fixture as well as a fresh seed.  Keep
-- durable item/mapping/result records; only payload, preview, and token bytes
-- are removed.  Subsequent seed replays use the same redacted fixed point.
update public.integration_sync_jobs
set approved_projection='[]'::jsonb,
  provider_preview_id=null,
  provider_confirmation_token=null,
  roster_snapshot=null
where id in ('29000000-0000-4000-8000-000000000162','29000000-0000-4000-8000-000000000163')
  and state in ('completed','failed')
  and (approved_projection<>'[]'::jsonb or provider_preview_id is not null
    or provider_confirmation_token is not null or roster_snapshot is not null);

-- The athlete helper has two intentionally different paths.  Organization
-- reports find the latest registration for each tenant athlete; tryout reports
-- scope candidates by the requested tryout before any descriptive joins.
create or replace function private.bounded_report_athlete_candidates(
  p_organization_id uuid,p_tryout_id uuid,p_max_rows integer
) returns table(athlete_id uuid,registration_id uuid)
language sql stable security definer set search_path='' as $$
  with candidates as materialized (
    select athlete.id
    from public.athletes athlete
    where athlete.organization_id=p_organization_id
      and (p_tryout_id is null or exists(
        select 1 from public.tryout_registrations registration
        where registration.organization_id=p_organization_id
          and registration.tryout_id=p_tryout_id
          and registration.athlete_id=athlete.id
      ))
    order by athlete.id
    limit (p_max_rows+1)
  )
  select candidate.id,registration.id
  from candidates candidate
  left join lateral (
    select registration.id
    from public.tryout_registrations registration
    where registration.organization_id=p_organization_id
      and registration.athlete_id=candidate.id
      and (p_tryout_id is null or registration.tryout_id=p_tryout_id)
    order by registration.created_at desc,registration.id desc
    limit 1
  ) registration on true
  order by candidate.id;
$$;

-- The submitted registration/session population is the single source of
-- truth for evaluation CSVs and summary lifecycle totals.  The limit is on
-- candidate pairs, before evaluations, scores, grouping, and presentation.
create or replace function private.bounded_report_evaluation_candidates(
  p_organization_id uuid,p_tryout_id uuid,p_max_rows integer
) returns table(registration_id uuid,session_id uuid)
language sql stable security definer set search_path='' as $$
  select registration.id,enrollment.session_id
  from public.tryout_registrations registration
  join public.session_enrollments enrollment
    on enrollment.organization_id=registration.organization_id
   and enrollment.tryout_id=registration.tryout_id
   and enrollment.registration_id=registration.id
  where registration.organization_id=p_organization_id
    and registration.tryout_id=p_tryout_id
    and registration.status='submitted'
  order by registration.id,enrollment.session_id
  limit (p_max_rows+1);
$$;

-- A legacy finalized roster is never a download target.  Managers keep an
-- exact verified revision link when one exists; reviewers receive an explicit
-- unavailable state only when their authorized finalized scope has no verified
-- version at all.
create or replace function public.load_report_summary(p_organization_id uuid,p_tryout_id uuid default null)
returns table(result jsonb)
language plpgsql stable security definer set search_path='' as $$
declare manager boolean; reviewer_roster uuid; reviewer_has_legacy boolean:=false;
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
    reviewer_has_legacy:=exists(select 1 from public.roster_versions roster
      left join private.roster_report_snapshots snapshot on snapshot.roster_version_id=roster.id
      where roster.organization_id=p_organization_id and roster.tryout_id=p_tryout_id and roster.state='finalized'
        and private.can_read_roster(roster.organization_id,roster.tryout_id,roster.division_id,true)
        and snapshot.roster_version_id is null);
  end if;
  if reviewer_roster is not null then
    return query select jsonb_build_object('outcome','ok','access','reviewer_roster','rosterVersionId',reviewer_roster); return;
  end if;
  if reviewer_has_legacy then
    return query select jsonb_build_object('outcome','ok','access','reviewer_roster_unavailable'); return;
  end if;
  return query select jsonb_build_object('outcome','forbidden');
end;
$$;

revoke all on function private.bounded_report_athlete_candidates(uuid,uuid,integer),
  private.bounded_report_evaluation_candidates(uuid,uuid,integer)
from public,anon,authenticated,service_role;
