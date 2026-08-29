-- Versioned roster writes are available only through actor-scoped transactions.
-- A roster is division-bound so a child-scoped director cannot widen a grant.

alter table public.tryout_registrations
  add constraint tryout_registrations_roster_scope_key
  unique (organization_id,tryout_id,division_id,id);

create table public.tryout_teams (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  tryout_id uuid not null,
  division_id uuid not null,
  name text not null,
  sort_order integer not null,
  target_size integer,
  position_targets jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint tryout_teams_organization_id_id_key unique (organization_id,id),
  constraint tryout_teams_scope_id_key unique (organization_id,tryout_id,division_id,id),
  constraint tryout_teams_division_fkey foreign key (organization_id,tryout_id,division_id)
    references public.tryout_divisions(organization_id,tryout_id,id) on delete cascade,
  constraint tryout_teams_name_check check (char_length(trim(name)) between 1 and 120),
  constraint tryout_teams_sort_check check (sort_order between 0 and 49),
  constraint tryout_teams_target_check check (target_size is null or target_size between 1 and 500),
  constraint tryout_teams_position_targets_check check (jsonb_typeof(position_targets)='object'),
  constraint tryout_teams_name_key unique (organization_id,tryout_id,division_id,name),
  constraint tryout_teams_order_key unique (organization_id,tryout_id,division_id,sort_order)
);
create index tryout_teams_scope_idx on public.tryout_teams(organization_id,tryout_id,division_id,sort_order);
create trigger set_tryout_teams_updated_at before update on public.tryout_teams
for each row execute function public.set_updated_at();

create table public.roster_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  tryout_id uuid not null,
  division_id uuid not null,
  revision_number integer not null,
  based_on_roster_version_id uuid,
  state text not null default 'draft',
  version bigint not null default 1,
  finalized_by_user_id uuid,
  finalized_at timestamptz,
  revision_reason text,
  created_by_user_id uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint roster_versions_organization_id_id_key unique (organization_id,id),
  constraint roster_versions_scope_id_key unique (organization_id,tryout_id,division_id,id),
  constraint roster_versions_division_fkey foreign key (organization_id,tryout_id,division_id)
    references public.tryout_divisions(organization_id,tryout_id,id) on delete restrict,
  constraint roster_versions_source_fkey foreign key (organization_id,tryout_id,division_id,based_on_roster_version_id)
    references public.roster_versions(organization_id,tryout_id,division_id,id) on delete restrict,
  constraint roster_versions_creator_fkey foreign key (created_by_user_id) references auth.users(id) on delete restrict,
  constraint roster_versions_finalizer_fkey foreign key (finalized_by_user_id) references auth.users(id) on delete restrict,
  constraint roster_versions_state_check check (state in ('draft','finalized')),
  constraint roster_versions_revision_check check (revision_number between 1 and 1000000000),
  constraint roster_versions_version_check check (version between 1 and 9007199254740991),
  constraint roster_versions_reason_check check (revision_reason is null or char_length(trim(revision_reason)) between 10 and 500),
  constraint roster_versions_lifecycle_check check (
    (state='draft' and finalized_by_user_id is null and finalized_at is null)
    or (state='finalized' and finalized_by_user_id is not null and finalized_at is not null)
  ),
  constraint roster_versions_initial_lineage_check check (
    (revision_number=1 and based_on_roster_version_id is null and revision_reason is null)
    or (revision_number>1 and based_on_roster_version_id is not null and revision_reason is not null)
  ),
  constraint roster_versions_revision_key unique (organization_id,tryout_id,division_id,revision_number)
);
create unique index roster_versions_one_draft_idx
  on public.roster_versions(organization_id,tryout_id,division_id) where state='draft';
create index roster_versions_scope_state_idx
  on public.roster_versions(organization_id,tryout_id,division_id,state,revision_number desc);
create trigger set_roster_versions_updated_at before update on public.roster_versions
for each row execute function public.set_updated_at();

create table public.roster_assignments (
  organization_id uuid not null,
  tryout_id uuid not null,
  division_id uuid not null,
  roster_version_id uuid not null,
  registration_id uuid not null,
  team_id uuid not null,
  assigned_by_user_id uuid not null,
  assigned_at timestamptz not null default clock_timestamp(),
  primary key (organization_id,roster_version_id,registration_id),
  constraint roster_assignments_version_fkey foreign key (organization_id,tryout_id,division_id,roster_version_id)
    references public.roster_versions(organization_id,tryout_id,division_id,id) on delete cascade,
  constraint roster_assignments_registration_fkey foreign key (organization_id,tryout_id,division_id,registration_id)
    references public.tryout_registrations(organization_id,tryout_id,division_id,id) on delete restrict,
  constraint roster_assignments_team_fkey foreign key (organization_id,tryout_id,division_id,team_id)
    references public.tryout_teams(organization_id,tryout_id,division_id,id) on delete restrict,
  constraint roster_assignments_actor_fkey foreign key (assigned_by_user_id) references auth.users(id) on delete restrict
);
create index roster_assignments_team_idx
  on public.roster_assignments(organization_id,tryout_id,division_id,roster_version_id,team_id);

create table public.roster_decisions (
  organization_id uuid not null,
  tryout_id uuid not null,
  division_id uuid not null,
  roster_version_id uuid not null,
  registration_id uuid not null,
  status text not null default 'undecided',
  changed_by_user_id uuid,
  changed_at timestamptz,
  primary key (organization_id,roster_version_id,registration_id),
  constraint roster_decisions_version_fkey foreign key (organization_id,tryout_id,division_id,roster_version_id)
    references public.roster_versions(organization_id,tryout_id,division_id,id) on delete cascade,
  constraint roster_decisions_registration_fkey foreign key (organization_id,tryout_id,division_id,registration_id)
    references public.tryout_registrations(organization_id,tryout_id,division_id,id) on delete restrict,
  constraint roster_decisions_actor_fkey foreign key (changed_by_user_id) references auth.users(id) on delete restrict,
  constraint roster_decisions_status_check check (status in ('undecided','callback','selected','waitlisted','released','withdrawn')),
  constraint roster_decisions_change_pair_check check ((changed_by_user_id is null)=(changed_at is null))
);
create index roster_decisions_scope_status_idx
  on public.roster_decisions(organization_id,tryout_id,division_id,roster_version_id,status);

create table public.decision_history (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  tryout_id uuid not null,
  division_id uuid not null,
  roster_version_id uuid not null,
  registration_id uuid not null,
  from_status text not null,
  to_status text not null,
  actor_user_id uuid not null,
  changed_at timestamptz not null default clock_timestamp(),
  constraint decision_history_organization_id_id_key unique (organization_id,id),
  constraint decision_history_decision_fkey foreign key (organization_id,roster_version_id,registration_id)
    references public.roster_decisions(organization_id,roster_version_id,registration_id) on delete restrict,
  constraint decision_history_version_fkey foreign key (organization_id,tryout_id,division_id,roster_version_id)
    references public.roster_versions(organization_id,tryout_id,division_id,id) on delete restrict,
  constraint decision_history_actor_fkey foreign key (actor_user_id) references auth.users(id) on delete restrict,
  constraint decision_history_from_check check (from_status in ('undecided','callback','selected','waitlisted','released','withdrawn')),
  constraint decision_history_to_check check (to_status in ('undecided','callback','selected','waitlisted','released','withdrawn')),
  constraint decision_history_transition_check check (from_status<>to_status)
);
create index decision_history_roster_idx
  on public.decision_history(organization_id,tryout_id,division_id,roster_version_id,changed_at,id);

create function private.lock_and_can_manage_roster(
  p_organization_id uuid,p_tryout_id uuid,p_division_id uuid
) returns boolean language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=auth.uid();
begin
  if actor is null then return false; end if;
  perform 1 from auth.users where id=actor for key share;
  perform 1 from public.organizations where id=p_organization_id for key share;
  perform 1 from public.tryouts where organization_id=p_organization_id and id=p_tryout_id for key share;
  perform 1 from public.tryout_divisions where organization_id=p_organization_id and tryout_id=p_tryout_id and id=p_division_id for key share;
  perform 1 from public.organization_members where organization_id=p_organization_id and user_id=actor for share;
  perform 1 from public.tryout_staff_assignments
    where organization_id=p_organization_id and user_id=actor and tryout_id=p_tryout_id
    order by id for share;
  return public.is_active_organization_member(p_organization_id,array['owner','administrator'])
    or exists(select 1 from public.tryout_staff_assignments assignment
      join public.organization_members member on member.organization_id=assignment.organization_id and member.user_id=assignment.user_id and member.status='active'
      where assignment.organization_id=p_organization_id and assignment.user_id=actor
        and assignment.tryout_id=p_tryout_id and assignment.role='director'
        and assignment.revoked_at is null and (assignment.expires_at is null or assignment.expires_at>clock_timestamp())
        and (assignment.scope_kind='tryout' or (assignment.scope_kind='division' and assignment.division_id=p_division_id)));
end;
$$;

create function private.can_read_roster(
  p_organization_id uuid,p_tryout_id uuid,p_division_id uuid,p_finalized boolean
) returns boolean language sql stable security definer set search_path='' as $$
  select public.is_active_organization_member(p_organization_id,array['owner','administrator'])
    or exists(select 1 from public.tryout_staff_assignments assignment
      join public.organization_members member on member.organization_id=assignment.organization_id and member.user_id=assignment.user_id and member.status='active'
      where assignment.organization_id=p_organization_id and assignment.user_id=auth.uid()
        and assignment.tryout_id=p_tryout_id and assignment.revoked_at is null
        and (assignment.expires_at is null or assignment.expires_at>clock_timestamp())
        and (
          (assignment.role='director' and (assignment.scope_kind='tryout' or (assignment.scope_kind='division' and assignment.division_id=p_division_id)))
          or (p_finalized and assignment.role='reviewer' and (assignment.scope_kind='tryout' or (assignment.scope_kind='division' and assignment.division_id=p_division_id)))
        ));
$$;

create function private.guard_roster_snapshot_mutation() returns trigger
language plpgsql set search_path='' as $$
declare target_roster uuid:=coalesce(new.roster_version_id,old.roster_version_id);
begin
  if exists(select 1 from public.roster_versions where id=target_roster and state='finalized') then
    raise exception 'finalized roster snapshots are immutable' using errcode='55000';
  end if;
  return case when tg_op='DELETE' then old else new end;
end;
$$;
create trigger guard_roster_assignments_snapshot before insert or update or delete on public.roster_assignments
for each row execute function private.guard_roster_snapshot_mutation();
create trigger guard_roster_decisions_snapshot before insert or update or delete on public.roster_decisions
for each row execute function private.guard_roster_snapshot_mutation();

create function private.prevent_decision_history_mutation() returns trigger
language plpgsql set search_path='' as $$ begin
  raise exception 'decision history is append-only' using errcode='55000';
end; $$;
create trigger prevent_decision_history_update before update on public.decision_history
for each row execute function private.prevent_decision_history_mutation();
create trigger prevent_decision_history_delete before delete on public.decision_history
for each row execute function private.prevent_decision_history_mutation();

create function private.prevent_finalized_roster_or_team_mutation() returns trigger
language plpgsql set search_path='' as $$
begin
  if tg_table_name='roster_versions' then
    if old.state='finalized' then
      raise exception 'finalized roster versions are immutable' using errcode='55000';
    end if;
  end if;
  if tg_table_name='tryout_teams' then
    if exists(
      select 1 from public.roster_versions version
      where version.organization_id=old.organization_id and version.tryout_id=old.tryout_id
        and version.division_id=old.division_id and version.state='finalized'
    ) then raise exception 'teams in finalized rosters are immutable' using errcode='55000'; end if;
  end if;
  return case when tg_op='DELETE' then old else new end;
end;
$$;
create trigger prevent_finalized_roster_version_mutation before update or delete on public.roster_versions
for each row execute function private.prevent_finalized_roster_or_team_mutation();
create trigger prevent_finalized_roster_team_mutation before update or delete on public.tryout_teams
for each row execute function private.prevent_finalized_roster_or_team_mutation();

create function public.create_roster_draft(
  p_organization_id uuid,p_tryout_id uuid,p_division_id uuid,p_teams jsonb
) returns table(outcome text,roster_version_id uuid,version bigint)
language plpgsql security definer set search_path='' as $$
declare roster_id uuid; team jsonb; team_index integer:=0; position_key text; position_value jsonb;
begin
  if p_organization_id is null or p_tryout_id is null or p_division_id is null or p_teams is null
    or not private.lock_and_can_manage_roster(p_organization_id,p_tryout_id,p_division_id)
  then return query select 'forbidden',null::uuid,null::bigint; return; end if;
  if not exists(select 1 from public.tryouts where organization_id=p_organization_id and id=p_tryout_id and status in ('published','finalized'))
    or not exists(select 1 from public.tryout_divisions where organization_id=p_organization_id and tryout_id=p_tryout_id and id=p_division_id)
  then return query select 'invalid_scope',null::uuid,null::bigint; return; end if;
  if exists(select 1 from public.roster_versions where organization_id=p_organization_id and tryout_id=p_tryout_id and division_id=p_division_id)
  then return query select 'conflict',null::uuid,null::bigint; return; end if;
  if jsonb_typeof(p_teams)<>'array' then return query select 'invalid_teams',null::uuid,null::bigint; return; end if;
  if jsonb_array_length(p_teams) not between 1 and 50
    or exists(select 1 from jsonb_array_elements(p_teams) item where jsonb_typeof(item)<>'object')
  then return query select 'invalid_teams',null::uuid,null::bigint; return; end if;
  if exists(select 1 from jsonb_array_elements(p_teams) item
      where exists(select 1 from jsonb_object_keys(item) as item_key where item_key not in ('name','targetSize','positionTargets'))
        or not (item ? 'name') or jsonb_typeof(item->'name')<>'string'
        or char_length(trim(item->>'name')) not between 1 and 120
        or (item ? 'targetSize' and case
          when item->'targetSize'='null'::jsonb then false
          when jsonb_typeof(item->'targetSize')<>'number' then true
          when (item->>'targetSize') !~ '^[0-9]+$' then true
          else (item->>'targetSize')::numeric not between 1 and 500 end)
        or (item ? 'positionTargets' and jsonb_typeof(item->'positionTargets')<>'object'))
    or (select count(*)<>count(distinct lower(trim(item->>'name'))) from jsonb_array_elements(p_teams) item)
  then return query select 'invalid_teams',null::uuid,null::bigint; return; end if;
  for team in select item from jsonb_array_elements(p_teams) item loop
    for position_key,position_value in select * from jsonb_each(coalesce(team->'positionTargets','{}'::jsonb)) loop
      if position_key !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then return query select 'invalid_teams',null::uuid,null::bigint; return;
      elsif jsonb_typeof(position_value)<>'number' or position_value::text !~ '^[0-9]+$'
      then return query select 'invalid_teams',null::uuid,null::bigint; return;
      elsif position_value::text::numeric not between 0 and 500
      then return query select 'invalid_teams',null::uuid,null::bigint; return;
      elsif not exists(select 1 from public.tryout_positions position where position.organization_id=p_organization_id and position.tryout_id=p_tryout_id and position.id=position_key::uuid)
      then return query select 'invalid_teams',null::uuid,null::bigint; return; end if;
    end loop;
  end loop;
  insert into public.roster_versions(organization_id,tryout_id,division_id,revision_number,created_by_user_id)
    values(p_organization_id,p_tryout_id,p_division_id,1,auth.uid()) returning id into roster_id;
  for team in select item from jsonb_array_elements(p_teams) item loop
    insert into public.tryout_teams(organization_id,tryout_id,division_id,name,sort_order,target_size,position_targets)
      values(p_organization_id,p_tryout_id,p_division_id,trim(team->>'name'),team_index,
        case when team->'targetSize'='null'::jsonb or not (team ? 'targetSize') then null else (team->>'targetSize')::integer end,
        coalesce(team->'positionTargets','{}'::jsonb));
    team_index:=team_index+1;
  end loop;
  insert into public.roster_decisions(organization_id,tryout_id,division_id,roster_version_id,registration_id)
    select p_organization_id,p_tryout_id,p_division_id,roster_id,registration.id
    from public.tryout_registrations registration
    where registration.organization_id=p_organization_id and registration.tryout_id=p_tryout_id
      and registration.division_id=p_division_id and registration.status='submitted';
  insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id)
    values(p_organization_id,auth.uid(),'roster.draft_created','roster_version',roster_id);
  return query select 'created',roster_id,1::bigint;
exception when unique_violation then return query select 'conflict',null::uuid,null::bigint;
end;
$$;

create function public.move_roster_athlete(
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
  if not exists(select 1 from public.tryout_registrations where organization_id=p_organization_id and tryout_id=p_tryout_id and division_id=p_division_id and id=p_registration_id and status='submitted')
  then return query select 'invalid_registration',roster.version; return; end if;
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

create function public.change_roster_decisions(
  p_organization_id uuid,p_tryout_id uuid,p_division_id uuid,p_roster_version_id uuid,
  p_changes jsonb,p_expected_version bigint,p_confirmation text
) returns table(outcome text,version bigint)
language plpgsql security definer set search_path='' as $$
declare roster public.roster_versions%rowtype; item jsonb; changed_count integer:=0; old_status text; new_status text; registration uuid;
begin
  if p_organization_id is null or p_tryout_id is null or p_division_id is null or p_roster_version_id is null
    or p_expected_version is null or p_expected_version<1 or not private.lock_and_can_manage_roster(p_organization_id,p_tryout_id,p_division_id)
  then return query select 'forbidden',null::bigint; return; end if;
  if p_confirmation is distinct from 'CONFIRM DECISIONS' then return query select 'confirmation_required',null::bigint; return; end if;
  select * into roster from public.roster_versions where organization_id=p_organization_id and tryout_id=p_tryout_id and division_id=p_division_id and id=p_roster_version_id for update;
  if not found then return query select 'invalid_roster',null::bigint; return; end if;
  if roster.state<>'draft' then return query select 'invalid_state',roster.version; return; end if;
  if roster.version<>p_expected_version then return query select 'conflict',roster.version; return; end if;
  if p_changes is null or jsonb_typeof(p_changes)<>'array'
  then return query select 'invalid_decisions',roster.version; return; end if;
  if jsonb_array_length(p_changes) not between 1 and 500
    or exists(select 1 from jsonb_array_elements(p_changes) change where jsonb_typeof(change)<>'object')
  then return query select 'invalid_decisions',roster.version; return; end if;
  if exists(select 1 from jsonb_array_elements(p_changes) change
      where exists(select 1 from jsonb_object_keys(change) key where key not in ('registrationId','status'))
      or not (change ? 'registrationId') or jsonb_typeof(change->'registrationId')<>'string'
      or not (change ? 'status') or jsonb_typeof(change->'status')<>'string'
      or (change->>'registrationId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or change->>'status' not in ('undecided','callback','selected','waitlisted','released','withdrawn'))
    or (select count(*)<>count(distinct change->>'registrationId') from jsonb_array_elements(p_changes) change)
  then return query select 'invalid_decisions',roster.version; return; end if;
  if exists(select 1 from jsonb_array_elements(p_changes) change left join public.roster_decisions decision
      on decision.organization_id=p_organization_id and decision.roster_version_id=p_roster_version_id and decision.registration_id=(change->>'registrationId')::uuid
      where decision.registration_id is null)
  then return query select 'invalid_registration',roster.version; return; end if;
  for item in select change from jsonb_array_elements(p_changes) change loop
    registration:=(item->>'registrationId')::uuid; new_status:=item->>'status';
    select status into old_status from public.roster_decisions
      where organization_id=p_organization_id and roster_version_id=p_roster_version_id and registration_id=registration for update;
    if old_status<>new_status then
      update public.roster_decisions set status=new_status,changed_by_user_id=auth.uid(),changed_at=clock_timestamp()
        where organization_id=p_organization_id and roster_version_id=p_roster_version_id and registration_id=registration;
      insert into public.decision_history(organization_id,tryout_id,division_id,roster_version_id,registration_id,from_status,to_status,actor_user_id)
        values(p_organization_id,p_tryout_id,p_division_id,p_roster_version_id,registration,old_status,new_status,auth.uid());
      changed_count:=changed_count+1;
    end if;
  end loop;
  if changed_count=0 then return query select 'unchanged',roster.version; return; end if;
  update public.roster_versions set version=roster_versions.version+1 where id=p_roster_version_id returning roster_versions.version into roster.version;
  insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id)
    values(p_organization_id,auth.uid(),'roster.decisions_changed','roster_version',p_roster_version_id);
  return query select 'changed',roster.version;
end;
$$;

create function public.finalize_roster_version(
  p_organization_id uuid,p_tryout_id uuid,p_division_id uuid,p_roster_version_id uuid,
  p_expected_version bigint,p_confirmation text
) returns table(outcome text,version bigint)
language plpgsql security definer set search_path='' as $$
declare roster public.roster_versions%rowtype;
begin
  if p_organization_id is null or p_tryout_id is null or p_division_id is null or p_roster_version_id is null
    or p_expected_version is null or p_expected_version<1 or not private.lock_and_can_manage_roster(p_organization_id,p_tryout_id,p_division_id)
  then return query select 'forbidden',null::bigint; return; end if;
  if p_confirmation is distinct from 'FINALIZE ROSTER' then return query select 'confirmation_required',null::bigint; return; end if;
  select * into roster from public.roster_versions where organization_id=p_organization_id and tryout_id=p_tryout_id and division_id=p_division_id and id=p_roster_version_id for update;
  if not found then return query select 'invalid_roster',null::bigint; return; end if;
  if roster.state<>'draft' then return query select 'invalid_state',roster.version; return; end if;
  if roster.version<>p_expected_version then return query select 'conflict',roster.version; return; end if;
  update public.roster_versions set state='finalized',version=roster_versions.version+1,finalized_by_user_id=auth.uid(),finalized_at=clock_timestamp()
    where id=p_roster_version_id returning roster_versions.version into roster.version;
  insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id)
    values(p_organization_id,auth.uid(),'roster.finalized','roster_version',p_roster_version_id);
  return query select 'finalized',roster.version;
end;
$$;

create function public.revise_roster_version(
  p_organization_id uuid,p_tryout_id uuid,p_division_id uuid,p_roster_version_id uuid,
  p_reason text,p_confirmation text
) returns table(outcome text,roster_version_id uuid,version bigint)
language plpgsql security definer set search_path='' as $$
declare source public.roster_versions%rowtype; new_id uuid; next_revision integer;
begin
  if p_organization_id is null or p_tryout_id is null or p_division_id is null or p_roster_version_id is null
    or not private.lock_and_can_manage_roster(p_organization_id,p_tryout_id,p_division_id)
  then return query select 'forbidden',null::uuid,null::bigint; return; end if;
  if p_confirmation is distinct from 'REVISE ROSTER' then return query select 'confirmation_required',null::uuid,null::bigint; return; end if;
  if p_reason is null or char_length(trim(p_reason)) not between 10 and 500 then return query select 'invalid_reason',null::uuid,null::bigint; return; end if;
  select * into source from public.roster_versions where organization_id=p_organization_id and tryout_id=p_tryout_id and division_id=p_division_id and id=p_roster_version_id for share;
  if not found then return query select 'invalid_roster',null::uuid,null::bigint; return; end if;
  if source.state<>'finalized' then return query select 'invalid_state',null::uuid,null::bigint; return; end if;
  if exists(select 1 from public.roster_versions where organization_id=p_organization_id and tryout_id=p_tryout_id and division_id=p_division_id and state='draft')
  then return query select 'conflict',null::uuid,null::bigint; return; end if;
  select max(revision_number)+1 into next_revision from public.roster_versions
    where organization_id=p_organization_id and tryout_id=p_tryout_id and division_id=p_division_id;
  if next_revision>1000000000 then return query select 'capacity',null::uuid,null::bigint; return; end if;
  insert into public.roster_versions(organization_id,tryout_id,division_id,revision_number,based_on_roster_version_id,revision_reason,created_by_user_id)
    values(p_organization_id,p_tryout_id,p_division_id,next_revision,p_roster_version_id,trim(p_reason),auth.uid()) returning id into new_id;
  insert into public.roster_assignments(organization_id,tryout_id,division_id,roster_version_id,registration_id,team_id,assigned_by_user_id,assigned_at)
    select assignment.organization_id,assignment.tryout_id,assignment.division_id,new_id,assignment.registration_id,assignment.team_id,assignment.assigned_by_user_id,assignment.assigned_at
    from public.roster_assignments assignment where assignment.organization_id=p_organization_id and assignment.roster_version_id=p_roster_version_id;
  insert into public.roster_decisions(organization_id,tryout_id,division_id,roster_version_id,registration_id,status,changed_by_user_id,changed_at)
    select decision.organization_id,decision.tryout_id,decision.division_id,new_id,decision.registration_id,decision.status,decision.changed_by_user_id,decision.changed_at
    from public.roster_decisions decision where decision.organization_id=p_organization_id and decision.roster_version_id=p_roster_version_id;
  insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id)
    values(p_organization_id,auth.uid(),'roster.revised','roster_version',new_id);
  return query select 'revised',new_id,1::bigint;
exception when unique_violation then return query select 'conflict',null::uuid,null::bigint;
end;
$$;

alter table public.tryout_teams enable row level security;
alter table public.roster_versions enable row level security;
alter table public.roster_assignments enable row level security;
alter table public.roster_decisions enable row level security;
alter table public.decision_history enable row level security;

create policy tryout_teams_read on public.tryout_teams for select to authenticated using (
  private.can_read_roster(organization_id,tryout_id,division_id,
    exists(select 1 from public.roster_versions version where version.organization_id=tryout_teams.organization_id and version.tryout_id=tryout_teams.tryout_id and version.division_id=tryout_teams.division_id and version.state='finalized'))
);
create policy roster_versions_read on public.roster_versions for select to authenticated using (
  private.can_read_roster(organization_id,tryout_id,division_id,state='finalized')
);
create policy roster_assignments_read on public.roster_assignments for select to authenticated using (
  exists(select 1 from public.roster_versions version where version.organization_id=roster_assignments.organization_id and version.id=roster_assignments.roster_version_id
    and private.can_read_roster(version.organization_id,version.tryout_id,version.division_id,version.state='finalized'))
);
create policy roster_decisions_read on public.roster_decisions for select to authenticated using (
  exists(select 1 from public.roster_versions version where version.organization_id=roster_decisions.organization_id and version.id=roster_decisions.roster_version_id
    and private.can_read_roster(version.organization_id,version.tryout_id,version.division_id,version.state='finalized'))
);
create policy decision_history_read on public.decision_history for select to authenticated using (
  exists(select 1 from public.roster_versions version where version.organization_id=decision_history.organization_id and version.id=decision_history.roster_version_id
    and private.can_read_roster(version.organization_id,version.tryout_id,version.division_id,version.state='finalized'))
);

revoke all on public.tryout_teams,public.roster_versions,public.roster_assignments,public.roster_decisions,public.decision_history from public,anon,authenticated,service_role;
grant select on public.tryout_teams,public.roster_versions,public.roster_assignments,public.roster_decisions,public.decision_history to authenticated;
revoke all on function private.lock_and_can_manage_roster(uuid,uuid,uuid),private.can_read_roster(uuid,uuid,uuid,boolean),private.guard_roster_snapshot_mutation(),private.prevent_decision_history_mutation(),private.prevent_finalized_roster_or_team_mutation() from public,anon,authenticated,service_role;
grant execute on function private.can_read_roster(uuid,uuid,uuid,boolean) to authenticated;
revoke all on function public.create_roster_draft(uuid,uuid,uuid,jsonb),public.move_roster_athlete(uuid,uuid,uuid,uuid,uuid,uuid,bigint),public.change_roster_decisions(uuid,uuid,uuid,uuid,jsonb,bigint,text),public.finalize_roster_version(uuid,uuid,uuid,uuid,bigint,text),public.revise_roster_version(uuid,uuid,uuid,uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.create_roster_draft(uuid,uuid,uuid,jsonb),public.move_roster_athlete(uuid,uuid,uuid,uuid,uuid,uuid,bigint),public.change_roster_decisions(uuid,uuid,uuid,uuid,jsonb,bigint,text),public.finalize_roster_version(uuid,uuid,uuid,uuid,bigint,text),public.revise_roster_version(uuid,uuid,uuid,uuid,text,text) to authenticated;
