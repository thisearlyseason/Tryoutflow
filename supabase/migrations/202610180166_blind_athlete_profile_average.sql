-- Pending qualification: replaces only the existing read-only aggregate RPC.
-- Requires migration 137 and evaluator_has_active_context from migration 042.
-- No tables, policies, write paths, grants or aggregate payload are broadened.
-- Apply only through separately approved migration rollout after DB tests.
-- A read-only aggregate for an assigned evaluator's current athlete/session.
-- Private notes, evaluator identities and individual peer scores never leave SQL.
create or replace function public.load_athlete_profile_average(
  p_organization_id uuid, p_tryout_id uuid, p_registration_id uuid,
  p_session_id uuid, p_rubric_version_id uuid
) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare profile jsonb;
begin
  perform private.require_billing_feature(p_organization_id,p_tryout_id,'radar_charts');
  if auth.uid() is null or not public.evaluator_has_active_context(
    p_organization_id,p_tryout_id,p_registration_id,p_session_id,auth.uid()
  ) then return null; end if;
  -- Blind scoring: an active assignment alone (including an owner's evaluator
  -- assignment) cannot reveal peers. The caller must have submitted this exact
  -- athlete/session/form, with current placement. Reopening immediately denies
  -- subsequent reads. The existing aggregate still excludes peer drafts/notes.
  if not exists (
    select 1 from public.evaluations own
    join public.tryout_registrations r on r.organization_id=own.organization_id
      and r.tryout_id=own.tryout_id and r.id=own.tryout_registration_id and r.status='submitted'
      and r.division_id=own.division_id
    join public.session_enrollments se on se.organization_id=own.organization_id
      and se.tryout_id=own.tryout_id and se.registration_id=r.id
      and se.session_id=own.tryout_session_id and se.group_id is not distinct from own.group_id
    where own.organization_id=p_organization_id and own.tryout_id=p_tryout_id
      and own.tryout_registration_id=p_registration_id and own.tryout_session_id=p_session_id
      and own.evaluator_user_id=auth.uid() and own.rubric_version_id=p_rubric_version_id
      and own.state in ('completed','locked')
  ) then return null; end if;

  with eligible as materialized (
    select e.id from public.evaluations e
    join public.tryout_registrations r on r.organization_id=e.organization_id
      and r.tryout_id=e.tryout_id and r.id=e.tryout_registration_id and r.status='submitted'
      and r.division_id=e.division_id
    join public.session_enrollments se on se.organization_id=e.organization_id
      and se.tryout_id=e.tryout_id and se.registration_id=r.id
      and se.session_id=e.tryout_session_id and se.group_id is not distinct from e.group_id
    join public.organization_members m on m.organization_id=e.organization_id
      and m.user_id=e.evaluator_user_id and m.status='active'
    where e.organization_id=p_organization_id and e.tryout_id=p_tryout_id
      and e.tryout_registration_id=p_registration_id and e.tryout_session_id=p_session_id
      and e.rubric_version_id=p_rubric_version_id and e.state in ('completed','locked')
      and exists (
        select 1 from public.tryout_staff_assignments a
        where a.organization_id=e.organization_id and a.tryout_id=e.tryout_id
          and a.user_id=e.evaluator_user_id and a.role='evaluator' and a.revoked_at is null
          and (a.expires_at is null or a.expires_at>clock_timestamp())
          and (a.scope_kind='tryout' or (a.scope_kind='division' and a.division_id=e.division_id)
            or (a.scope_kind='session' and a.session_id=e.tryout_session_id)
            or (a.scope_kind='group' and a.session_id=e.tryout_session_id and a.group_id=e.group_id))
      )
  ), averages as (
    select c.id, c.sort_order, avg(s.value) value, count(*) count
    from eligible e
    join public.evaluation_scores s on s.evaluation_id=e.id
      and s.organization_id=p_organization_id and s.tryout_id=p_tryout_id
      and s.rubric_version_id=p_rubric_version_id
    join public.rubric_categories c on c.id=s.rubric_category_id
      and c.organization_id=s.organization_id and c.tryout_id=s.tryout_id
      and c.rubric_version_id=s.rubric_version_id
    group by c.id,c.sort_order
  )
  select jsonb_build_object(
    'evaluationCount',(select count(*) from eligible),
    'scores',coalesce((select jsonb_agg(jsonb_build_object('categoryId',id,'value',value,'count',count)
      order by sort_order,id) from averages),'[]'::jsonb)
  ) into profile;
  return profile;
end;
$$;
revoke all on function public.load_athlete_profile_average(uuid,uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.load_athlete_profile_average(uuid,uuid,uuid,uuid,uuid) to authenticated;
