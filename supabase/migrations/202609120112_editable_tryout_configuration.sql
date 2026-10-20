-- Organizers edit the same tryout throughout its lifecycle. A private, transaction-bound
-- command capability admits only the selected setup step; callers cannot forge it with a GUC.
create table private.tryout_configuration_commands (
  transaction_id xid8 not null,
  backend_pid integer not null,
  organization_id uuid not null,
  tryout_id uuid not null,
  actor_user_id uuid not null,
  step text not null check(step in ('basics','divisions','sessions','registration','rubrics')),
  primary key(transaction_id,backend_pid,organization_id,tryout_id)
);
alter table private.tryout_configuration_commands enable row level security;
revoke all on private.tryout_configuration_commands from public,anon,authenticated,service_role;

create function private.tryout_configuration_command_allows(p_organization_id uuid,p_tryout_id uuid,p_steps text[])
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from private.tryout_configuration_commands c
    where c.transaction_id=pg_current_xact_id() and c.backend_pid=pg_backend_pid()
      and c.organization_id=p_organization_id and c.tryout_id=p_tryout_id and c.actor_user_id=auth.uid()
      and c.step=any(p_steps));
$$;
revoke all on function private.tryout_configuration_command_allows(uuid,uuid,text[]) from public,anon,authenticated,service_role;

create or replace function public.prevent_tryout_boundary_or_lifecycle_mutation()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if old.organization_id is distinct from new.organization_id then
    raise exception 'tryout organization is immutable' using errcode = '23514';
  end if;

  if old.published_at is not null and new.published_at is distinct from old.published_at then
    raise exception 'published timestamp is immutable' using errcode = '23514';
  end if;

  if old.finalized_at is not null and new.finalized_at is distinct from old.finalized_at then
    raise exception 'finalized timestamp is immutable' using errcode = '23514';
  end if;

  if old.status = 'draft' and new.status = 'published' then
    if new.published_at is null or new.finalized_at is not null then
      raise exception 'published tryouts require one publication timestamp' using errcode = '23514';
    end if;
    return new;
  end if;

  if old.status = 'published' and new.status = 'finalized' then
    if new.published_at is distinct from old.published_at
      or new.finalized_at is null then
      raise exception 'finalized tryouts retain publication time and require finalization time' using errcode = '23514';
    end if;
    return new;
  end if;

  if old.status <> new.status then
    raise exception 'invalid tryout lifecycle transition' using errcode = '23514';
  end if;

  if old.status = 'draft' then
    if new.published_at is not null or new.finalized_at is not null then
      raise exception 'draft lifecycle timestamps must remain null' using errcode = '23514';
    end if;
    return new;
  end if;

  if private.tryout_configuration_command_allows(old.organization_id,old.id,array['basics'])
    and (to_jsonb(new)-array['name','sport','timezone','registration_starts_at','registration_ends_at','updated_at','version'])
      is not distinct from (to_jsonb(old)-array['name','sport','timezone','registration_starts_at','registration_ends_at','updated_at','version']) then
    return new;
  end if;
  if (to_jsonb(new) - 'updated_at' - 'version') is distinct from (to_jsonb(old) - 'updated_at' - 'version') then
    raise exception 'published tryout configuration is immutable' using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function public.prevent_published_configuration_mutation()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  target_organization_id uuid := coalesce(new.organization_id, old.organization_id);
  target_tryout_id uuid := coalesce(new.tryout_id, old.tryout_id);
  target_status text;
begin
  if tg_op = 'UPDATE' and (
    (to_jsonb(old) ->> 'id') is distinct from (to_jsonb(new) ->> 'id')
    or (to_jsonb(old) ->> 'organization_id') is distinct from (to_jsonb(new) ->> 'organization_id')
    or (to_jsonb(old) ->> 'tryout_id') is distinct from (to_jsonb(new) ->> 'tryout_id')
    or (to_jsonb(old) ->> 'division_id') is distinct from (to_jsonb(new) ->> 'division_id')
    or (to_jsonb(old) ->> 'session_id') is distinct from (to_jsonb(new) ->> 'session_id')
  ) then
    raise exception 'configuration tenant and tryout boundaries are immutable' using errcode = '23514';
  end if;

  select status into target_status
  from public.tryouts
  where organization_id = target_organization_id and id = target_tryout_id;

  if target_status in ('published', 'finalized') and pg_trigger_depth() = 1
    and not (tg_op<>'DELETE' and private.tryout_configuration_command_allows(target_organization_id,target_tryout_id,
      case when tg_table_name='tryout_divisions' then array['divisions'] else array['sessions'] end)) then
    raise exception 'published tryout configuration is immutable' using errcode = '23514';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function public.prevent_published_session_rubric_mutation()
returns trigger language plpgsql security definer set search_path='' as $$
declare target_status text;
begin
  if tg_op='UPDATE' and (old.id is distinct from new.id or old.organization_id is distinct from new.organization_id
    or old.tryout_id is distinct from new.tryout_id or old.session_id is distinct from new.session_id) then
    raise exception 'session rubric identity is immutable' using errcode='23514';
  end if;
  select status into target_status from public.tryouts
    where organization_id=old.organization_id and id=old.tryout_id;
  if target_status in ('published','finalized') and not (tg_op='UPDATE'
    and private.tryout_configuration_command_allows(old.organization_id,old.tryout_id,array['rubrics'])) then
    raise exception 'published tryout configuration is immutable' using errcode='23514';
  end if;
  return coalesce(new,old);
end;
$$;

create function private.save_tryout_setup_configuration(p_organization_id uuid,p_tryout_id uuid,p_step text,p_payload jsonb)
returns table(outcome text) language plpgsql security definer set search_path='' as $$
#variable_conflict use_variable
declare
  target public.tryouts%rowtype;
  target_division_id uuid;
  created_session_id uuid;
  form_id uuid;
  form_version_id uuid;
  rubric_id uuid;
  rubric_version_id uuid;
  target_group_id uuid;
  target_position_id uuid;
  category jsonb;
  category_index integer;
  categories jsonb;
  starts_at_instant timestamptz;
  ends_at_instant timestamptz;
begin
  if not public.can_manage_tryout_root(p_organization_id,p_tryout_id) then
    raise exception 'forbidden' using errcode='42501';
  end if;
  select tryout.* into target
  from public.tryouts as tryout
  where tryout.organization_id=p_organization_id and tryout.id=p_tryout_id
  for update;
  if not found then return query select 'not_found'::text; return; end if;
  if jsonb_typeof(p_payload) is distinct from 'object' then return query select 'invalid_input'::text; return; end if;
  if p_payload ? 'expectedVersion' and (p_payload->>'expectedVersion')::integer is distinct from target.version then
    return query select 'conflict'::text; return;
  end if;

  if p_step='basics' then
    if coalesce(trim(p_payload->>'name'),'')='' or coalesce(trim(p_payload->>'sport'),'')=''
      or coalesce(trim(p_payload->>'timezone'),'')='' then
      return query select 'invalid_input'::text; return;
    end if;
    starts_at_instant:=private.tryout_wizard_instant(p_payload->>'registrationStartsAt',trim(p_payload->>'timezone'));
    ends_at_instant:=private.tryout_wizard_instant(p_payload->>'registrationEndsAt',trim(p_payload->>'timezone'));
    if starts_at_instant is null or ends_at_instant is null or ends_at_instant<=starts_at_instant then
      return query select 'invalid_input'::text; return;
    end if;
    update public.tryouts as tryout
    set name=trim(p_payload->>'name'),sport=trim(p_payload->>'sport'),
      timezone=trim(p_payload->>'timezone'),
      registration_starts_at=starts_at_instant,
      registration_ends_at=ends_at_instant
    where tryout.id=target.id and tryout.organization_id=target.organization_id;
  elsif p_step='divisions' then
    if coalesce(trim(p_payload->>'name'),'')='' then
      return query select 'invalid_input'::text; return;
    end if;
    target_division_id:=nullif(p_payload->>'divisionId','')::uuid;
    if target_division_id is not null then
      update public.tryout_divisions set name=trim(p_payload->>'name'),
        description=case when p_payload?'description' then nullif(p_payload->>'description','') else description end,
        min_age=case when p_payload?'minAge' then nullif(p_payload->>'minAge','')::integer else min_age end,
        max_age=case when p_payload?'maxAge' then nullif(p_payload->>'maxAge','')::integer else max_age end
      where organization_id=p_organization_id and tryout_id=p_tryout_id and id=target_division_id;
      if not found then return query select 'invalid_input'::text; return; end if;
    else
      insert into public.tryout_divisions(organization_id,tryout_id,name,description,min_age,max_age,sort_order)
      values(p_organization_id,p_tryout_id,trim(p_payload->>'name'),nullif(p_payload->>'description',''),
        nullif(p_payload->>'minAge','')::integer,nullif(p_payload->>'maxAge','')::integer,
        (select coalesce(max(d.sort_order),-1)+1 from public.tryout_divisions d
         where d.organization_id=p_organization_id and d.tryout_id=p_tryout_id));
    end if;
  elsif p_step='sessions' then
    target_division_id:=nullif(p_payload->>'divisionId','')::uuid;
    if target_division_id is null or coalesce(trim(p_payload->>'name'),'')=''
      or p_payload->>'startsAt' is null or p_payload->>'endsAt' is null then
      return query select 'invalid_input'::text; return;
    end if;
    starts_at_instant:=private.tryout_wizard_instant(p_payload->>'startsAt',target.timezone);
    ends_at_instant:=private.tryout_wizard_instant(p_payload->>'endsAt',target.timezone);
    if starts_at_instant is null or ends_at_instant is null or ends_at_instant<=starts_at_instant then
      return query select 'invalid_input'::text; return;
    end if;
    created_session_id:=nullif(p_payload->>'sessionId','')::uuid;
    target_group_id:=nullif(p_payload->>'groupId','')::uuid;
    target_position_id:=nullif(p_payload->>'positionId','')::uuid;
    -- Validate every supplied identity before making any write; omitted ids mean add.
    if not exists(select 1 from public.tryout_divisions d where d.organization_id=p_organization_id
        and d.tryout_id=p_tryout_id and d.id=target_division_id)
      or (created_session_id is not null and not exists(select 1 from public.tryout_sessions s
        where s.organization_id=p_organization_id and s.tryout_id=p_tryout_id and s.id=created_session_id
          and s.division_id=target_division_id))
      or (target_group_id is not null and (created_session_id is null or not exists(
        select 1 from public.session_groups g where g.organization_id=p_organization_id
          and g.tryout_id=p_tryout_id and g.session_id=created_session_id and g.id=target_group_id)))
      or (target_position_id is not null and not exists(select 1 from public.tryout_positions pos
        where pos.organization_id=p_organization_id and pos.tryout_id=p_tryout_id and pos.id=target_position_id))
      or (target_group_id is not null and coalesce(trim(p_payload->>'groupName'),'')='')
      or (target_position_id is not null and coalesce(trim(p_payload->>'positionName'),'')='')
    then return query select 'invalid_input'::text; return; end if;
    if created_session_id is not null then
      update public.tryout_sessions set name=trim(p_payload->>'name'),starts_at=starts_at_instant,ends_at=ends_at_instant,
        location=case when p_payload?'location' then nullif(trim(p_payload->>'location'),'') else location end,
        capacity=case when p_payload?'capacity' then nullif(p_payload->>'capacity','')::integer else capacity end
      where organization_id=p_organization_id and tryout_id=p_tryout_id and id=created_session_id;
    else
      insert into public.tryout_sessions(organization_id,tryout_id,division_id,name,starts_at,ends_at,location,capacity,sort_order)
      values(p_organization_id,p_tryout_id,target_division_id,trim(p_payload->>'name'),starts_at_instant,ends_at_instant,
        nullif(trim(p_payload->>'location'),''),nullif(p_payload->>'capacity','')::integer,
        (select coalesce(max(s.sort_order),-1)+1 from public.tryout_sessions s where s.organization_id=p_organization_id
          and s.tryout_id=p_tryout_id and s.division_id=target_division_id)) returning id into created_session_id;
    end if;
    if coalesce(trim(p_payload->>'groupName'),'')<>'' then
      if target_group_id is not null then
        update public.session_groups set name=trim(p_payload->>'groupName')
        where organization_id=p_organization_id and tryout_id=p_tryout_id and session_id=created_session_id and id=target_group_id;
      else
        insert into public.session_groups(organization_id,tryout_id,session_id,name,sort_order)
        values(p_organization_id,p_tryout_id,created_session_id,trim(p_payload->>'groupName'),
          (select coalesce(max(g.sort_order),-1)+1 from public.session_groups g where g.organization_id=p_organization_id
            and g.tryout_id=p_tryout_id and g.session_id=created_session_id));
      end if;
    end if;
    if coalesce(trim(p_payload->>'positionName'),'')<>'' then
      if target_position_id is not null then
        update public.tryout_positions set name=trim(p_payload->>'positionName')
        where organization_id=p_organization_id and tryout_id=p_tryout_id and id=target_position_id;
      else
        insert into public.tryout_positions(organization_id,tryout_id,name,sort_order)
        values(p_organization_id,p_tryout_id,trim(p_payload->>'positionName'),
          (select coalesce(max(pos.sort_order),-1)+1 from public.tryout_positions pos
           where pos.organization_id=p_organization_id and pos.tryout_id=p_tryout_id));
      end if;
    end if;
  elsif p_step='registration' then
    if coalesce(trim(p_payload->>'name'),'')='' then
      return query select 'invalid_input'::text; return;
    end if;
    insert into public.registration_forms(organization_id,tryout_id,name)
    values(p_organization_id,p_tryout_id,trim(p_payload->>'name'))
    on conflict (organization_id,tryout_id,name) do update set name=excluded.name
    returning id into form_id;
    select id into form_version_id from public.registration_form_versions
    where organization_id=p_organization_id and registration_form_id=form_id and status='draft';
    if form_version_id is not null then
      update public.registration_form_versions
      set schema=coalesce(p_payload->'schema','{"fields":[]}'::jsonb)
      where id=form_version_id and organization_id=p_organization_id;
    else
      insert into public.registration_form_versions(
        organization_id,tryout_id,registration_form_id,version_number,schema
      ) values(
        p_organization_id,p_tryout_id,form_id,
        (select coalesce(max(version_number),0)+1 from public.registration_form_versions
         where organization_id=p_organization_id and registration_form_id=form_id),
        coalesce(p_payload->'schema','{"fields":[]}'::jsonb)
      ) returning id into form_version_id;
    end if;
    if target.status in ('published','finalized') then
      update public.registration_form_versions set status='published',published_at=clock_timestamp()
      where id=form_version_id and organization_id=p_organization_id;
    end if;
    insert into public.tryout_registration_form_selections(
      organization_id,tryout_id,registration_form_version_id
    ) values(p_organization_id,p_tryout_id,form_version_id)
    on conflict (organization_id,tryout_id) do update
      set registration_form_version_id=excluded.registration_form_version_id,updated_at=clock_timestamp();
    insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id)
    values(p_organization_id,auth.uid(),'registration_form.saved','tryout',p_tryout_id);
  elsif p_step='rubrics' then
    created_session_id:=nullif(p_payload->>'sessionId','')::uuid;
    if created_session_id is null or coalesce(trim(p_payload->>'name'),'')='' then
      return query select 'invalid_input'::text; return;
    end if;
    if not exists(select 1 from public.tryout_sessions s where s.organization_id=p_organization_id
      and s.tryout_id=p_tryout_id and s.id=created_session_id) then return query select 'invalid_input'::text; return; end if;
    categories:=coalesce(p_payload->'categories',jsonb_build_array(jsonb_build_object(
      'name',coalesce(nullif(trim(p_payload->>'categoryName'),''),'Overall'),'weight',100,'scaleMin',1,'scaleMax',5)));
    if jsonb_typeof(categories) is distinct from 'array' then return query select 'invalid_input'::text; return; end if;
    if jsonb_array_length(categories) not between 1 and 50
      or exists(select 1 from jsonb_array_elements(categories) c where jsonb_typeof(c) is distinct from 'object'
        or coalesce(trim(c->>'name'),'')='' or (c->>'weight')::numeric is null
        or (c->>'scaleMin')::integer is distinct from 1 or (c->>'scaleMax')::integer not in (5,10)
        or (c->>'scaleMax')::integer is null
        or (c->>'weight')::numeric<>round((c->>'weight')::numeric,2))
      or (select sum((c->>'weight')::numeric) from jsonb_array_elements(categories) c)<>100
    then return query select 'invalid_input'::text; return; end if;
    insert into public.rubrics(organization_id,tryout_id,name)
    values(p_organization_id,p_tryout_id,trim(p_payload->>'name'))
    on conflict (organization_id,tryout_id,name) do update set name=excluded.name returning id into rubric_id;
    select v.id into rubric_version_id from public.rubric_versions v
    where v.organization_id=p_organization_id and v.tryout_id=p_tryout_id and v.rubric_id=rubric_id and v.status='draft';
    -- A legacy draft may be shared by several sessions. Freeze that snapshot
    -- before revising just this session, so another selection cannot change.
    if rubric_version_id is not null and exists(select 1 from public.session_rubrics sr
      where sr.organization_id=p_organization_id and sr.rubric_version_id=rubric_version_id
        and sr.session_id<>created_session_id) then
      if (select coalesce(sum(c.weight),0) from public.rubric_categories c
        where c.organization_id=p_organization_id and c.rubric_version_id=rubric_version_id)<>100 then
        raise exception 'shared draft rubric requires valid weights' using errcode='23514';
      end if;
      update public.rubric_versions v set status='published',published_at=clock_timestamp()
      where v.organization_id=p_organization_id and v.id=rubric_version_id;
      rubric_version_id:=null;
    end if;
    if rubric_version_id is null then
      insert into public.rubric_versions(organization_id,tryout_id,rubric_id,version_number)
      values(p_organization_id,p_tryout_id,rubric_id,
        (select coalesce(max(v.version_number),0)+1 from public.rubric_versions v
         where v.organization_id=p_organization_id and v.rubric_id=rubric_id)) returning id into rubric_version_id;
    else
      delete from public.rubric_categories c where c.organization_id=p_organization_id and c.rubric_version_id=rubric_version_id;
    end if;
    category_index:=0;
    for category in select value from jsonb_array_elements(categories) loop
      insert into public.rubric_categories(organization_id,tryout_id,rubric_version_id,name,description,sort_order,
        weight,scale_min,scale_max,guidance,is_priority)
      values(p_organization_id,p_tryout_id,rubric_version_id,trim(category->>'name'),nullif(category->>'description',''),
        category_index,(category->>'weight')::numeric,(category->>'scaleMin')::integer,(category->>'scaleMax')::integer,
        nullif(category->>'guidance',''),coalesce((category->>'isPriority')::boolean,false));
      category_index:=category_index+1;
    end loop;
    -- A wizard save is a complete rubric snapshot even while the tryout is a
    -- draft. Future edits create another version instead of rewriting this one.
    update public.rubric_versions v set status='published',published_at=clock_timestamp()
    where v.organization_id=p_organization_id and v.id=rubric_version_id;
    insert into public.session_rubrics(organization_id,tryout_id,session_id,rubric_version_id)
    values(p_organization_id,p_tryout_id,created_session_id,rubric_version_id)
    on conflict (organization_id,session_id) do update set rubric_version_id=excluded.rubric_version_id;
  else
    return query select 'invalid_input'::text; return;
  end if;
  -- The parent lock serializes setup, publication, and evaluator-context reads.
  if p_step<>'basics' then
    update public.tryouts set updated_at=clock_timestamp() where organization_id=p_organization_id and id=p_tryout_id;
  end if;
  insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,details)
  values(p_organization_id,auth.uid(),'tryout.configuration_saved','tryout',p_tryout_id,
    jsonb_build_object('step',p_step,'previousVersion',target.version,'status',target.status));
  return query select 'saved'::text;
end;
$$;
revoke all on function private.save_tryout_setup_configuration(uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;

create or replace function public.save_tryout_wizard_configuration(p_organization_id uuid,p_tryout_id uuid,p_step text,p_payload jsonb)
returns table(outcome text) language plpgsql security definer set search_path='' as $$
declare saved_outcome text;
begin
  if not public.can_manage_tryout_root(p_organization_id,p_tryout_id) then
    raise exception 'forbidden' using errcode='42501';
  end if;
  if p_step is null or p_step not in ('basics','divisions','sessions','registration','rubrics') then
    return query select 'invalid_input'::text; return;
  end if;
  insert into private.tryout_configuration_commands(transaction_id,backend_pid,organization_id,tryout_id,actor_user_id,step)
  values(pg_current_xact_id(),pg_backend_pid(),p_organization_id,p_tryout_id,auth.uid(),p_step);
  -- A failed input rolls back the entire command, including any already inserted children.
  begin
    select result.outcome into saved_outcome from private.save_tryout_setup_configuration(p_organization_id,p_tryout_id,p_step,p_payload) result;
  exception when invalid_text_representation or numeric_value_out_of_range or check_violation or unique_violation or foreign_key_violation then
    saved_outcome:='invalid_input';
  end;
  delete from private.tryout_configuration_commands where transaction_id=pg_current_xact_id()
    and backend_pid=pg_backend_pid() and organization_id=p_organization_id and tryout_id=p_tryout_id;
  return query select saved_outcome;
end;
$$;
revoke all on function public.save_tryout_wizard_configuration(uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.save_tryout_wizard_configuration(uuid,uuid,text,jsonb) to authenticated;

-- Keep every selected version as an immutable provenance edge. Evaluation rows
-- already pin their own version; this retains their eligibility in ranking reads.
create table private.session_rubric_version_history (
  organization_id uuid not null,
  tryout_id uuid not null,
  session_id uuid not null,
  rubric_version_id uuid not null,
  selected_at timestamptz not null default clock_timestamp(),
  primary key(organization_id,tryout_id,session_id,rubric_version_id),
  foreign key(organization_id,tryout_id,session_id)
    references public.tryout_sessions(organization_id,tryout_id,id) on delete cascade,
  foreign key(organization_id,tryout_id,rubric_version_id)
    references public.rubric_versions(organization_id,tryout_id,id) on delete restrict
);
alter table private.session_rubric_version_history enable row level security;
revoke all on private.session_rubric_version_history from public,anon,authenticated,service_role;
insert into private.session_rubric_version_history(organization_id,tryout_id,session_id,rubric_version_id)
select organization_id,tryout_id,session_id,rubric_version_id from public.session_rubrics
union select organization_id,tryout_id,tryout_session_id,rubric_version_id from public.evaluations;
create function private.record_session_rubric_version_history()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  insert into private.session_rubric_version_history(organization_id,tryout_id,session_id,rubric_version_id)
  values(new.organization_id,new.tryout_id,new.session_id,new.rubric_version_id) on conflict do nothing;
  return new;
end;
$$;
revoke all on function private.record_session_rubric_version_history() from public,anon,authenticated,service_role;
create trigger record_session_rubric_version_history after insert or update on public.session_rubrics
for each row execute function private.record_session_rubric_version_history();

-- Existing scorecards continue on their pinned version; new scorecards must use
-- the current selection. lock_evaluator_context holds the parent FOR SHARE before
-- these checks, serializing them with the setup command's parent FOR UPDATE lock.
create function private.evaluation_rubric_is_current_or_bound(
  p_organization_id uuid,p_tryout_id uuid,p_session_id uuid,p_registration_id uuid,p_rubric_version_id uuid
) returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.rubric_versions rv
    where rv.organization_id=p_organization_id and rv.tryout_id=p_tryout_id
      and rv.id=p_rubric_version_id and rv.status='published'
      and exists(select 1 from public.session_rubrics current_binding
        where current_binding.organization_id=p_organization_id and current_binding.tryout_id=p_tryout_id
          and current_binding.session_id=p_session_id)
      and (exists(select 1 from public.session_rubrics sr
        where sr.organization_id=p_organization_id and sr.tryout_id=p_tryout_id
          and sr.session_id=p_session_id and sr.rubric_version_id=rv.id)
        or exists(select 1 from public.evaluations e
          where e.organization_id=p_organization_id and e.tryout_id=p_tryout_id
            and e.tryout_session_id=p_session_id and e.tryout_registration_id=p_registration_id
            and e.evaluator_user_id=auth.uid() and e.rubric_version_id=rv.id)));
$$;
revoke all on function private.evaluation_rubric_is_current_or_bound(uuid,uuid,uuid,uuid,uuid)
from public,anon,authenticated,service_role;

-- Preserve the installed mutation receipt, authorization, and ranking contracts.
-- Replace only their current-selection predicates, failing closed if these
-- expected predecessor definitions are absent instead of silently losing guards.
do $migration$
declare fn regprocedure; definition text; original text; changed text;
begin
  foreach fn in array array[
    'public.save_evaluation_draft(uuid,uuid,uuid,uuid,uuid,uuid,uuid,integer,jsonb,text,uuid[],text[])'::regprocedure,
    'public.sync_evaluation_mutation_legacy(uuid,uuid,uuid,uuid,uuid,uuid,uuid,integer,jsonb)'::regprocedure
  ] loop
    definition:=pg_get_functiondef(fn);
    original:=substring(definition from '  perform 1 from public.session_rubrics sr join public.rubric_versions rv[\s\S]*?  if not found then');
    if original is null then raise exception 'expected evaluation selection guard absent: %',fn; end if;
    changed:='  if not private.evaluation_rubric_is_current_or_bound(p_organization_id,p_tryout_id,p_session_id,p_registration_id,p_rubric_version_id) then';
    execute replace(definition,original,changed);
  end loop;
  fn:='public.load_ranking_snapshot(uuid,uuid,uuid,uuid,uuid,uuid,uuid[])'::regprocedure;
  definition:=pg_get_functiondef(fn);
  original:='join public.session_rubrics binding on binding.organization_id=evaluation.organization_id';
  if position(original in definition)=0 then raise exception 'expected ranking provenance guard absent'; end if;
  definition:=replace(definition,original,'join private.session_rubric_version_history binding on binding.organization_id=evaluation.organization_id');
  execute replace(definition,'join public.session_rubrics binding on binding.organization_id=p_organization_id',
    'join private.session_rubric_version_history binding on binding.organization_id=p_organization_id');
end;
$migration$;

create function public.get_tryout_setup_configuration(p_organization_id uuid,p_tryout_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if not public.can_manage_tryout_root(p_organization_id,p_tryout_id) then raise exception 'forbidden' using errcode='42501'; end if;
  if not exists(select 1 from public.tryouts t where t.organization_id=p_organization_id and t.id=p_tryout_id) then return null; end if;
  return jsonb_build_object(
    'divisions',coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'name',d.name,'description',d.description,
      'min_age',d.min_age,'max_age',d.max_age) order by d.sort_order)
      from public.tryout_divisions d where d.organization_id=p_organization_id and d.tryout_id=p_tryout_id),'[]'::jsonb),
    'positions',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.name) order by p.sort_order)
      from public.tryout_positions p where p.organization_id=p_organization_id and p.tryout_id=p_tryout_id),'[]'::jsonb),
    'sessions',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'division_id',s.division_id,
      'starts_at',s.starts_at,'ends_at',s.ends_at,'location',s.location,'capacity',s.capacity,
      'groups',coalesce((select jsonb_agg(jsonb_build_object('id',g.id,'name',g.name) order by g.sort_order)
        from public.session_groups g where g.organization_id=s.organization_id and g.tryout_id=s.tryout_id and g.session_id=s.id),'[]'::jsonb),
      'rubric',(select jsonb_build_object('id',r.id,'name',r.name,'versionId',v.id,
        'categories',coalesce((select jsonb_agg(jsonb_build_object('name',c.name,'weight',c.weight,
          'scaleMin',c.scale_min,'scaleMax',c.scale_max,'description',c.description,'guidance',c.guidance,'isPriority',c.is_priority)
          order by c.sort_order) from public.rubric_categories c
          where c.organization_id=v.organization_id and c.tryout_id=v.tryout_id and c.rubric_version_id=v.id),'[]'::jsonb))
        from public.session_rubrics sr join public.rubric_versions v on v.organization_id=sr.organization_id
          and v.tryout_id=sr.tryout_id and v.id=sr.rubric_version_id
        join public.rubrics r on r.organization_id=v.organization_id and r.tryout_id=v.tryout_id and r.id=v.rubric_id
        where sr.organization_id=s.organization_id and sr.tryout_id=s.tryout_id and sr.session_id=s.id))
      order by s.sort_order,s.starts_at,s.id) from public.tryout_sessions s
      where s.organization_id=p_organization_id and s.tryout_id=p_tryout_id),'[]'::jsonb));
end;
$$;
revoke all on function public.get_tryout_setup_configuration(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_tryout_setup_configuration(uuid,uuid) to authenticated;
