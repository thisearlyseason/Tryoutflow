-- Roster membership is an immutable/versioned product fact.  This projection
-- reads that exact snapshot without depending on session-enrollment ranking
-- eligibility, and exposes only the identity needed to operate the roster.

create function public.load_roster_workspace(
  p_organization_id uuid,
  p_tryout_id uuid,
  p_division_id uuid,
  p_roster_version_id uuid
) returns table(result jsonb)
language plpgsql stable security definer set search_path='' as $$
declare target public.roster_versions%rowtype;
begin
  if p_organization_id is null or p_tryout_id is null or p_division_id is null
    or p_roster_version_id is null or auth.uid() is null then
    return query select jsonb_build_object('outcome','forbidden');
    return;
  end if;

  select * into target
  from public.roster_versions version
  where version.organization_id=p_organization_id
    and version.tryout_id=p_tryout_id
    and version.division_id=p_division_id
    and version.id=p_roster_version_id;

  if target.id is null then
    return query select jsonb_build_object(
      'outcome',
      case when private.can_read_roster(p_organization_id,p_tryout_id,p_division_id,false)
        then 'invalid_scope' else 'forbidden' end
    );
    return;
  end if;

  if not private.can_read_roster(
    p_organization_id,p_tryout_id,p_division_id,target.state='finalized'
  ) then
    return query select jsonb_build_object('outcome','forbidden');
    return;
  end if;

  return query select jsonb_build_object(
    'outcome','ok',
    'snapshot',jsonb_build_object(
      'rosterVersionId',target.id,
      'state',target.state,
      'version',target.version,
      'revisionNumber',target.revision_number,
      'basedOnRosterVersionId',target.based_on_roster_version_id,
      'revisionReason',target.revision_reason,
      'finalizedAt',target.finalized_at,
      'teams',coalesce((
        select jsonb_agg(jsonb_build_object(
          'id',team.id,
          'name',team.name,
          'targetSize',team.target_size,
          'positionTargets',team.position_targets
        ) order by team.sort_order,team.id)
        from public.tryout_teams team
        where team.organization_id=p_organization_id
          and team.tryout_id=p_tryout_id
          and team.division_id=p_division_id
      ),'[]'::jsonb),
      'positions',coalesce((
        select jsonb_agg(jsonb_build_object('id',position.id,'name',position.name)
          order by position.sort_order,position.id)
        from public.tryout_positions position
        where position.organization_id=p_organization_id
          and position.tryout_id=p_tryout_id
      ),'[]'::jsonb),
      'members',coalesce((
        select jsonb_agg(jsonb_build_object(
          'registrationId',decision.registration_id,
          'displayName',trim(athlete.given_name||' '||athlete.family_name),
          'tryoutNumber',(
            select number.number
            from public.tryout_numbers number
            where number.organization_id=p_organization_id
              and number.tryout_id=p_tryout_id
              and number.registration_id=decision.registration_id
              and number.division_id=p_division_id
              and number.released_at is null
            order by case number.scope_kind
              when 'group' then 1 when 'session' then 2 when 'division' then 3 else 4 end,
              number.assigned_at desc,number.id
            limit 1
          ),
          'positionId',registration.position_id,
          'positionName',position.name,
          'decision',decision.status,
          'teamId',assignment.team_id
        ) order by decision.registration_id)
        from public.roster_decisions decision
        join public.tryout_registrations registration
          on registration.organization_id=decision.organization_id
          and registration.tryout_id=decision.tryout_id
          and registration.division_id=decision.division_id
          and registration.id=decision.registration_id
        join public.athletes athlete
          on athlete.organization_id=registration.organization_id
          and athlete.id=registration.athlete_id
        left join public.tryout_positions position
          on position.organization_id=registration.organization_id
          and position.tryout_id=registration.tryout_id
          and position.id=registration.position_id
        left join public.roster_assignments assignment
          on assignment.organization_id=decision.organization_id
          and assignment.roster_version_id=decision.roster_version_id
          and assignment.registration_id=decision.registration_id
        where decision.organization_id=p_organization_id
          and decision.tryout_id=p_tryout_id
          and decision.division_id=p_division_id
          and decision.roster_version_id=p_roster_version_id
      ),'[]'::jsonb)
    )
  );
end;
$$;

revoke all on function public.load_roster_workspace(uuid,uuid,uuid,uuid)
from public,anon,authenticated,service_role;
grant execute on function public.load_roster_workspace(uuid,uuid,uuid,uuid)
to authenticated;
