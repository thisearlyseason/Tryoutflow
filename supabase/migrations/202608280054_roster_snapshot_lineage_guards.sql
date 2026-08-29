-- Close snapshot-membership, finalized-child, and stale-revision gaps without
-- changing the shipped roster migration.

alter table public.roster_assignments
  add constraint roster_assignments_snapshot_member_fkey
  foreign key (organization_id,roster_version_id,registration_id)
  references public.roster_decisions(organization_id,roster_version_id,registration_id)
  on delete restrict;

create or replace function private.guard_roster_snapshot_mutation() returns trigger
language plpgsql set search_path='' as $$
begin
  if tg_op in ('UPDATE','DELETE') and exists(
    select 1 from public.roster_versions where id=old.roster_version_id and state='finalized'
  ) then
    raise exception 'finalized roster snapshots are immutable' using errcode='55000';
  end if;
  if tg_op in ('INSERT','UPDATE') and exists(
    select 1 from public.roster_versions where id=new.roster_version_id and state='finalized'
  ) then
    raise exception 'finalized roster snapshots are immutable' using errcode='55000';
  end if;
  return case when tg_op='DELETE' then old else new end;
end;
$$;

create trigger guard_decision_history_snapshot_insert before insert on public.decision_history
for each row execute function private.guard_roster_snapshot_mutation();

create or replace function private.prevent_finalized_roster_or_team_mutation() returns trigger
language plpgsql set search_path='' as $$
declare
  old_organization uuid;
  old_tryout uuid;
  old_division uuid;
  new_organization uuid;
  new_tryout uuid;
  new_division uuid;
begin
  if tg_table_name='roster_versions' then
    if old.state='finalized' then
      raise exception 'finalized roster versions are immutable' using errcode='55000';
    end if;
  elsif tg_table_name='tryout_teams' then
    if tg_op in ('UPDATE','DELETE') then
      old_organization:=old.organization_id;
      old_tryout:=old.tryout_id;
      old_division:=old.division_id;
      if exists(
        select 1 from public.roster_versions version
        where version.organization_id=old_organization and version.tryout_id=old_tryout
          and version.division_id=old_division and version.state='finalized'
      ) then
        raise exception 'teams in finalized rosters are immutable' using errcode='55000';
      end if;
    end if;
    if tg_op in ('INSERT','UPDATE') then
      new_organization:=new.organization_id;
      new_tryout:=new.tryout_id;
      new_division:=new.division_id;
      if exists(
        select 1 from public.roster_versions version
        where version.organization_id=new_organization and version.tryout_id=new_tryout
          and version.division_id=new_division and version.state='finalized'
      ) then
        raise exception 'teams in finalized rosters are immutable' using errcode='55000';
      end if;
    end if;
  end if;
  return case when tg_op='DELETE' then old else new end;
end;
$$;

drop trigger prevent_finalized_roster_team_mutation on public.tryout_teams;
create trigger prevent_finalized_roster_team_mutation before insert or update or delete on public.tryout_teams
for each row execute function private.prevent_finalized_roster_or_team_mutation();

alter table public.roster_assignments enable always trigger guard_roster_assignments_snapshot;
alter table public.roster_decisions enable always trigger guard_roster_decisions_snapshot;
alter table public.decision_history enable always trigger guard_decision_history_snapshot_insert;
alter table public.decision_history enable always trigger prevent_decision_history_update;
alter table public.decision_history enable always trigger prevent_decision_history_delete;
alter table public.roster_versions enable always trigger prevent_finalized_roster_version_mutation;
alter table public.tryout_teams enable always trigger prevent_finalized_roster_team_mutation;

create or replace function public.move_roster_athlete(
  p_organization_id uuid,p_tryout_id uuid,p_division_id uuid,p_roster_version_id uuid,
  p_registration_id uuid,p_team_id uuid,p_expected_version bigint
) returns table(outcome text,version bigint)
language plpgsql security definer set search_path='' as $$
declare roster public.roster_versions%rowtype; current_team uuid;
begin
  if p_organization_id is null or p_tryout_id is null or p_division_id is null or p_roster_version_id is null or p_registration_id is null
    or p_expected_version is null or p_expected_version<1 or not private.lock_and_can_manage_roster(p_organization_id,p_tryout_id,p_division_id)
  then return query select 'forbidden',null::bigint; return; end if;
  select * into roster from public.roster_versions where organization_id=p_organization_id and tryout_id=p_tryout_id and division_id=p_division_id and id=p_roster_version_id for update;
  if not found then return query select 'invalid_roster',null::bigint; return; end if;
  if roster.state<>'draft' then return query select 'invalid_state',roster.version; return; end if;
  if roster.version<>p_expected_version then return query select 'conflict',roster.version; return; end if;
  if not exists(
    select 1 from public.roster_decisions decision
    where decision.organization_id=p_organization_id
      and decision.roster_version_id=p_roster_version_id
      and decision.registration_id=p_registration_id
  ) then return query select 'invalid_registration',roster.version; return; end if;
  if p_team_id is not null and not exists(select 1 from public.tryout_teams where organization_id=p_organization_id and tryout_id=p_tryout_id and division_id=p_division_id and id=p_team_id)
  then return query select 'invalid_team',roster.version; return; end if;
  select team_id into current_team from public.roster_assignments where organization_id=p_organization_id and roster_version_id=p_roster_version_id and registration_id=p_registration_id;
  if current_team is not distinct from p_team_id then return query select 'unchanged',roster.version; return; end if;
  if p_team_id is null then
    delete from public.roster_assignments where organization_id=p_organization_id and roster_version_id=p_roster_version_id and registration_id=p_registration_id;
  else
    insert into public.roster_assignments(organization_id,tryout_id,division_id,roster_version_id,registration_id,team_id,assigned_by_user_id)
      values(p_organization_id,p_tryout_id,p_division_id,p_roster_version_id,p_registration_id,p_team_id,auth.uid())
    on conflict(organization_id,roster_version_id,registration_id) do update
      set team_id=excluded.team_id,assigned_by_user_id=excluded.assigned_by_user_id,assigned_at=clock_timestamp();
  end if;
  update public.roster_versions set version=roster_versions.version+1 where id=p_roster_version_id returning roster_versions.version into roster.version;
  insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id)
    values(p_organization_id,auth.uid(),'roster.athlete_moved','roster_version',p_roster_version_id);
  return query select 'moved',roster.version;
end;
$$;

drop function public.revise_roster_version(uuid,uuid,uuid,uuid,text,text);

create function public.revise_roster_version(
  p_organization_id uuid,p_tryout_id uuid,p_division_id uuid,p_roster_version_id uuid,
  p_expected_version bigint,p_reason text,p_confirmation text
) returns table(outcome text,roster_version_id uuid,version bigint)
language plpgsql security definer set search_path='' as $$
declare source public.roster_versions%rowtype; new_id uuid; next_revision integer; latest_finalized_id uuid;
begin
  if p_organization_id is null or p_tryout_id is null or p_division_id is null or p_roster_version_id is null
    or p_expected_version is null or p_expected_version<1
    or not private.lock_and_can_manage_roster(p_organization_id,p_tryout_id,p_division_id)
  then return query select 'forbidden',null::uuid,null::bigint; return; end if;
  if p_confirmation is distinct from 'REVISE ROSTER' then return query select 'confirmation_required',null::uuid,null::bigint; return; end if;
  if p_reason is null or char_length(trim(p_reason)) not between 10 and 500 then return query select 'invalid_reason',null::uuid,null::bigint; return; end if;

  perform roster.id from public.roster_versions roster
    where roster.organization_id=p_organization_id and roster.tryout_id=p_tryout_id and roster.division_id=p_division_id
    order by roster.revision_number,roster.id for update;

  select * into source from public.roster_versions
    where organization_id=p_organization_id and tryout_id=p_tryout_id and division_id=p_division_id and id=p_roster_version_id;
  if not found then return query select 'invalid_roster',null::uuid,null::bigint; return; end if;
  if source.state<>'finalized' then return query select 'invalid_state',null::uuid,null::bigint; return; end if;
  if source.version<>p_expected_version then return query select 'conflict',null::uuid,source.version; return; end if;
  select roster.id into latest_finalized_id from public.roster_versions roster
    where roster.organization_id=p_organization_id and roster.tryout_id=p_tryout_id and roster.division_id=p_division_id and roster.state='finalized'
    order by roster.revision_number desc,roster.id desc limit 1;
  if latest_finalized_id is distinct from p_roster_version_id
    or exists(select 1 from public.roster_versions roster where roster.organization_id=p_organization_id and roster.tryout_id=p_tryout_id and roster.division_id=p_division_id and roster.state='draft')
  then return query select 'conflict',null::uuid,source.version; return; end if;
  select max(revision_number)+1 into next_revision from public.roster_versions
    where organization_id=p_organization_id and tryout_id=p_tryout_id and division_id=p_division_id;
  if next_revision>1000000000 then return query select 'capacity',null::uuid,null::bigint; return; end if;
  insert into public.roster_versions(organization_id,tryout_id,division_id,revision_number,based_on_roster_version_id,revision_reason,created_by_user_id)
    values(p_organization_id,p_tryout_id,p_division_id,next_revision,p_roster_version_id,trim(p_reason),auth.uid()) returning id into new_id;
  insert into public.roster_decisions(organization_id,tryout_id,division_id,roster_version_id,registration_id,status,changed_by_user_id,changed_at)
    select decision.organization_id,decision.tryout_id,decision.division_id,new_id,decision.registration_id,decision.status,decision.changed_by_user_id,decision.changed_at
    from public.roster_decisions decision where decision.organization_id=p_organization_id and decision.roster_version_id=p_roster_version_id;
  insert into public.roster_assignments(organization_id,tryout_id,division_id,roster_version_id,registration_id,team_id,assigned_by_user_id,assigned_at)
    select assignment.organization_id,assignment.tryout_id,assignment.division_id,new_id,assignment.registration_id,assignment.team_id,assignment.assigned_by_user_id,assignment.assigned_at
    from public.roster_assignments assignment where assignment.organization_id=p_organization_id and assignment.roster_version_id=p_roster_version_id;
  insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id)
    values(p_organization_id,auth.uid(),'roster.revised','roster_version',new_id);
  return query select 'revised',new_id,1::bigint;
exception when unique_violation then return query select 'conflict',null::uuid,source.version;
end;
$$;

revoke all on function private.guard_roster_snapshot_mutation(),private.prevent_finalized_roster_or_team_mutation() from public,anon,authenticated,service_role;
revoke all on function public.revise_roster_version(uuid,uuid,uuid,uuid,bigint,text,text) from public,anon,authenticated,service_role;
grant execute on function public.revise_roster_version(uuid,uuid,uuid,uuid,bigint,text,text) to authenticated;
