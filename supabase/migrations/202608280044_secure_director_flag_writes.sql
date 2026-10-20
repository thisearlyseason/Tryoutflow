-- Reserve director-flag ownership and audit transitions to the exact manager RPC.

create table private.director_flag_write_permits (
  transaction_id bigint not null,
  flag_id uuid not null,
  operation text not null check(operation in ('insert','update','revoke')),
  organization_id uuid not null,
  tryout_id uuid not null,
  division_id uuid not null,
  registration_id uuid not null,
  session_id uuid not null,
  group_id uuid,
  creator_user_id uuid not null,
  flag_type text not null,
  primary key(transaction_id,flag_id)
);
revoke all on private.director_flag_write_permits from public,anon,authenticated,service_role;

create function private.permit_director_flag_write(
  p_flag_id uuid,p_operation text,p_organization_id uuid,p_tryout_id uuid,p_division_id uuid,
  p_registration_id uuid,p_session_id uuid,p_group_id uuid,p_creator_user_id uuid,p_flag_type text
) returns void language plpgsql security definer set search_path='' as $$
begin
  if p_operation not in ('insert','update','revoke') then
    raise exception 'invalid director flag write permit' using errcode='22023';
  end if;
  insert into private.director_flag_write_permits(
    transaction_id,flag_id,operation,organization_id,tryout_id,division_id,registration_id,
    session_id,group_id,creator_user_id,flag_type
  ) values(
    txid_current(),p_flag_id,p_operation,p_organization_id,p_tryout_id,p_division_id,
    p_registration_id,p_session_id,p_group_id,p_creator_user_id,p_flag_type
  );
end;
$$;
revoke all on function private.permit_director_flag_write(uuid,text,uuid,uuid,uuid,uuid,uuid,uuid,uuid,text)
  from public,anon,authenticated,service_role;

create function private.enforce_athlete_flag_ownership()
returns trigger language plpgsql security definer set search_path='' as $$
declare
  expected_operation text;
  parent_evaluation public.evaluations%rowtype;
  permit_operation text;
begin
  if tg_op='DELETE' then
    if old.creator_kind='director' then
      raise exception 'director flag writes require trusted command' using errcode='P0001';
    end if;
    return old;
  end if;

  if tg_op='UPDATE' and old.creator_kind is distinct from new.creator_kind then
    if new.creator_kind='director' then
      raise exception 'director flag writes require trusted command' using errcode='P0001';
    end if;
    raise exception 'director flag identity is immutable' using errcode='55000';
  end if;

  if new.creator_kind='director' then
    if tg_op='UPDATE' and row(
      old.id,old.organization_id,old.tryout_id,old.division_id,old.tryout_registration_id,
      old.tryout_session_id,old.group_id,old.creator_user_id,old.creator_kind,old.evaluation_id,
      old.evaluator_user_id,old.created_at
    ) is distinct from row(
      new.id,new.organization_id,new.tryout_id,new.division_id,new.tryout_registration_id,
      new.tryout_session_id,new.group_id,new.creator_user_id,new.creator_kind,new.evaluation_id,
      new.evaluator_user_id,new.created_at
    ) then
      raise exception 'director flag identity is immutable' using errcode='55000';
    end if;
    if new.evaluation_id is not null or new.evaluator_user_id is not null then
      raise exception 'invalid director flag ownership' using errcode='55000';
    end if;

    if tg_op='INSERT' then
      expected_operation:='insert';
      if new.revoked_at is not null then
        raise exception 'invalid director flag transition' using errcode='55000';
      end if;
    elsif old.revoked_at is null and new.revoked_at is not null
      and old.flag_type=new.flag_type then
      expected_operation:='revoke';
    elsif old.revoked_at is not distinct from new.revoked_at then
      expected_operation:='update';
    else
      raise exception 'invalid director flag transition' using errcode='55000';
    end if;

    delete from private.director_flag_write_permits p
    where p.transaction_id=txid_current() and p.flag_id=new.id
      and p.operation=expected_operation
      and p.organization_id=new.organization_id and p.tryout_id=new.tryout_id
      and p.division_id=new.division_id and p.registration_id=new.tryout_registration_id
      and p.session_id=new.tryout_session_id and p.group_id is not distinct from new.group_id
      and p.creator_user_id=new.creator_user_id and p.flag_type=new.flag_type
    returning p.operation into permit_operation;
    if permit_operation is null then
      raise exception 'director flag writes require trusted command' using errcode='P0001';
    end if;
    return new;
  end if;

  if new.creator_kind<>'evaluator' or new.evaluation_id is null
    or new.evaluator_user_id is distinct from new.creator_user_id or new.revoked_at is not null
  then raise exception 'invalid evaluator flag ownership' using errcode='55000'; end if;
  if tg_op='UPDATE' and row(
    old.id,old.organization_id,old.tryout_id,old.division_id,old.tryout_registration_id,
    old.tryout_session_id,old.group_id,old.creator_user_id,old.creator_kind,old.evaluation_id,
    old.evaluator_user_id,old.created_at
  ) is distinct from row(
    new.id,new.organization_id,new.tryout_id,new.division_id,new.tryout_registration_id,
    new.tryout_session_id,new.group_id,new.creator_user_id,new.creator_kind,new.evaluation_id,
    new.evaluator_user_id,new.created_at
  ) then raise exception 'evaluator flag identity is immutable' using errcode='55000'; end if;

  select * into parent_evaluation from public.evaluations e
  where e.organization_id=new.organization_id and e.id=new.evaluation_id;
  if not found or row(
    parent_evaluation.tryout_id,parent_evaluation.division_id,parent_evaluation.tryout_registration_id,
    parent_evaluation.tryout_session_id,parent_evaluation.group_id,parent_evaluation.evaluator_user_id
  ) is distinct from row(
    new.tryout_id,new.division_id,new.tryout_registration_id,new.tryout_session_id,new.group_id,new.evaluator_user_id
  ) then raise exception 'evaluator flag context must match its evaluation' using errcode='55000'; end if;
  return new;
end;
$$;
revoke all on function private.enforce_athlete_flag_ownership() from public,anon,authenticated,service_role;
create trigger enforce_athlete_flag_ownership before insert or update or delete on public.athlete_flags
  for each row execute function private.enforce_athlete_flag_ownership();

create or replace function public.manage_director_evaluation_flag(
  p_organization_id uuid,p_tryout_id uuid,p_division_id uuid,p_registration_id uuid,
  p_session_id uuid,p_group_id uuid,p_flag_id uuid,p_action text,p_flag_type text
) returns table(outcome text,athlete_flag_id uuid)
language plpgsql security definer set search_path='' as $$
declare
  target public.athlete_flags%rowtype;
  saved_id uuid;
  actor_id uuid:=auth.uid();
  revoked_at_value timestamptz;
begin
  if p_action not in ('upsert','revoke') or p_flag_type not in ('needs_another_look','injury_concern','eligibility_review')
  then return query select 'invalid_flag',null::uuid; return; end if;
  if not public.lock_manager_evaluation_context(p_organization_id,p_tryout_id,p_division_id,p_registration_id,p_session_id,p_group_id)
  then return query select 'forbidden',null::uuid; return; end if;
  if p_flag_id is not null then
    select * into target from public.athlete_flags f
    where f.organization_id=p_organization_id and f.id=p_flag_id for update;
    if not found or target.creator_kind<>'director'
      or target.tryout_id<>p_tryout_id or target.division_id<>p_division_id
      or target.tryout_registration_id<>p_registration_id or target.tryout_session_id<>p_session_id
      or target.group_id is distinct from p_group_id
    then return query select 'forbidden',null::uuid; return; end if;
  end if;
  if p_action='revoke' then
    if p_flag_id is null or target.revoked_at is not null then return query select 'invalid_flag',null::uuid; return; end if;
    revoked_at_value:=clock_timestamp();
    perform private.permit_director_flag_write(target.id,'revoke',target.organization_id,target.tryout_id,
      target.division_id,target.tryout_registration_id,target.tryout_session_id,target.group_id,
      target.creator_user_id,target.flag_type);
    update public.athlete_flags set revoked_at=revoked_at_value where id=target.id returning id into saved_id;
    insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,details)
    values(p_organization_id,actor_id,'evaluation.director_flag_revoked','athlete_flag',saved_id,
      jsonb_build_object('flagType',target.flag_type,'registrationId',p_registration_id,'sessionId',p_session_id));
    return query select 'revoked',saved_id; return;
  end if;
  if p_flag_id is null then
    saved_id:=gen_random_uuid();
    begin
      perform private.permit_director_flag_write(saved_id,'insert',p_organization_id,p_tryout_id,
        p_division_id,p_registration_id,p_session_id,p_group_id,actor_id,p_flag_type);
      insert into public.athlete_flags(id,organization_id,tryout_id,division_id,tryout_registration_id,
        tryout_session_id,group_id,creator_user_id,creator_kind,flag_type)
      values(saved_id,p_organization_id,p_tryout_id,p_division_id,p_registration_id,p_session_id,p_group_id,
        actor_id,'director',p_flag_type);
    exception when unique_violation then return query select 'conflict',null::uuid; return; end;
  else
    if target.revoked_at is not null then return query select 'invalid_flag',null::uuid; return; end if;
    begin
      perform private.permit_director_flag_write(target.id,'update',target.organization_id,target.tryout_id,
        target.division_id,target.tryout_registration_id,target.tryout_session_id,target.group_id,
        target.creator_user_id,p_flag_type);
      update public.athlete_flags set flag_type=p_flag_type where id=target.id returning id into saved_id;
    exception when unique_violation then return query select 'conflict',null::uuid; return; end;
  end if;
  insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,details)
  values(p_organization_id,actor_id,'evaluation.director_flag_saved','athlete_flag',saved_id,
    jsonb_build_object('flagType',p_flag_type,'registrationId',p_registration_id,'sessionId',p_session_id));
  return query select 'saved',saved_id;
end;
$$;
revoke all on function public.manage_director_evaluation_flag(uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,text)
  from public,anon,authenticated,service_role;
grant execute on function public.manage_director_evaluation_flag(uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,text)
  to authenticated;
