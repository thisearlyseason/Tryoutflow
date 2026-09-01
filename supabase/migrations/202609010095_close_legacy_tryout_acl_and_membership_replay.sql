-- Exceptional final closure: remove the obsolete cycle-less draft grant and
-- make membership replay actor-authorized, immutable, and independent of live
-- target state. Existing receipts have no trustworthy result snapshot and
-- therefore fail closed as conflicts on replay after this additive upgrade.

revoke all on function public.create_tryout_draft(
  uuid,uuid,text,text,text,text,timestamptz,timestamptz
) from public,anon,authenticated,service_role;

alter table private.membership_command_receipts
  add column result_snapshot jsonb,
  add column result_digest text,
  add constraint membership_command_receipts_result_pair_check check(
    (result_snapshot is null and result_digest is null)
    or (
      jsonb_typeof(result_snapshot)='object'
      and result_digest~'^[0-9a-f]{64}$'
    )
  );

create function private.membership_result_digest(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_idempotency_key uuid,
  p_command_kind text,
  p_request_digest text,
  p_result_snapshot jsonb
) returns text
language sql immutable strict set search_path=''
as $$
  select encode(extensions.digest(convert_to(jsonb_build_object(
    'organization_id',p_organization_id,
    'actor_user_id',p_actor_user_id,
    'idempotency_key',p_idempotency_key,
    'command_kind',p_command_kind,
    'request_digest',p_request_digest,
    'result_snapshot',p_result_snapshot
  )::text,'UTF8'),'sha256'),'hex');
$$;

create function private.prevent_membership_command_receipt_mutation()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
  raise object_not_in_prerequisite_state using message='membership command receipts are immutable';
end;
$$;

create trigger prevent_membership_command_receipt_mutation
before update or delete on private.membership_command_receipts
for each row execute function private.prevent_membership_command_receipt_mutation();

create or replace function public.change_organization_member(
  p_organization_id uuid,
  p_member_id uuid,
  p_role text,
  p_status text,
  p_expected_version bigint,
  p_idempotency_key uuid
) returns table(outcome text,member_id uuid,role text,status text,version bigint)
language plpgsql security definer set search_path=''
as $$
declare
  actor_id uuid:=auth.uid();
  actor public.organization_members%rowtype;
  target public.organization_members%rowtype;
  prior private.membership_command_receipts%rowtype;
  old_role text;
  old_status text;
  request_digest text;
  result_outcome text;
  result_snapshot jsonb;
  result_digest text;
begin
  if actor_id is null then raise insufficient_privilege using message='authentication required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(concat_ws(':','membership',p_organization_id),0));
  select * into actor from public.organization_members member
  where member.organization_id=p_organization_id
    and member.user_id=actor_id
    and member.status='active'
  for update;
  if actor.id is null or actor.role not in('owner','administrator') then
    return query select 'forbidden',null::uuid,null::text,null::text,null::bigint;
    return;
  end if;
  if p_idempotency_key is null or p_expected_version is null or p_expected_version<0 then
    return query select 'invalid',null::uuid,null::text,null::text,null::bigint;
    return;
  end if;
  request_digest:=encode(extensions.digest(convert_to(jsonb_build_object(
    'member_id',p_member_id,
    'role',p_role,
    'status',p_status,
    'expected_version',p_expected_version
  )::text,'UTF8'),'sha256'),'hex');

  select * into prior from private.membership_command_receipts receipt
  where receipt.organization_id=p_organization_id
    and receipt.actor_user_id=actor_id
    and receipt.idempotency_key=p_idempotency_key;
  if found then
    if prior.command_kind<>'member_change'
      or prior.request_digest<>request_digest
      or prior.result_snapshot is null
      or prior.result_digest is null
      or prior.result_digest<>private.membership_result_digest(
        prior.organization_id,prior.actor_user_id,prior.idempotency_key,
        prior.command_kind,prior.request_digest,prior.result_snapshot
      )
      or prior.result_snapshot->>'outcome' is distinct from prior.outcome
      or prior.result_snapshot->>'outcome' not in('updated','not_found','forbidden','conflict','invalid')
      or exists(
        select 1 from jsonb_object_keys(prior.result_snapshot) result_key
        where result_key not in('outcome','member_id','role','status','version')
      )
      or (
        prior.result_snapshot->>'member_id' is not null
        and prior.result_snapshot->>'member_id' !~
          '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      )
      or (
        prior.result_snapshot->'version' is not null
        and prior.result_snapshot->'version'<>'null'::jsonb
        and jsonb_typeof(prior.result_snapshot->'version')<>'number'
      )
    then
      return query select 'conflict',null::uuid,null::text,null::text,null::bigint;
      return;
    end if;
    return query select
      prior.result_snapshot->>'outcome',
      (prior.result_snapshot->>'member_id')::uuid,
      prior.result_snapshot->>'role',
      prior.result_snapshot->>'status',
      (prior.result_snapshot->>'version')::bigint;
    return;
  end if;

  select * into target from public.organization_members member
  where member.organization_id=p_organization_id and member.id=p_member_id
  for update;
  if target.id is null then result_outcome:='not_found';
  elsif target.user_id=actor_id or target.role='owner' then result_outcome:='forbidden';
  elsif p_role is null or p_status is null
    or p_role not in('administrator','member') or p_status not in('active','disabled')
  then result_outcome:='invalid';
  elsif target.version<>p_expected_version then result_outcome:='conflict';
  elsif actor.role='administrator' and (target.role<>'member' or p_role<>'member') then result_outcome:='forbidden';
  else
    old_role:=target.role;
    old_status:=target.status;
    update public.organization_members member
    set role=p_role,status=p_status,version=member.version+1
    where member.id=target.id
    returning * into target;
    result_outcome:='updated';
  end if;

  result_snapshot:=jsonb_build_object(
    'outcome',result_outcome,
    'member_id',target.id,
    'role',target.role,
    'status',target.status,
    'version',target.version
  );
  result_digest:=private.membership_result_digest(
    p_organization_id,actor_id,p_idempotency_key,'member_change',request_digest,result_snapshot
  );
  insert into private.membership_command_receipts(
    organization_id,actor_user_id,idempotency_key,command_kind,request_digest,
    outcome,result_snapshot,result_digest
  ) values(
    p_organization_id,actor_id,p_idempotency_key,'member_change',request_digest,
    result_outcome,result_snapshot,result_digest
  );

  if result_outcome='updated' then
    if old_role is distinct from target.role then
      insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,details)
      values(p_organization_id,actor_id,'organization.member.role_changed','organization_member',target.id,
        jsonb_build_object('beforeRole',old_role,'afterRole',target.role,'version',target.version));
    end if;
    if old_status is distinct from target.status then
      insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,details)
      values(p_organization_id,actor_id,'organization.member.status_changed','organization_member',target.id,
        jsonb_build_object('beforeStatus',old_status,'afterStatus',target.status,'version',target.version));
    end if;
  end if;
  return query select result_outcome,target.id,target.role,target.status,target.version;
end;
$$;

create or replace function public.transfer_organization_ownership(
  p_organization_id uuid,
  p_target_member_id uuid,
  p_expected_actor_version bigint,
  p_expected_target_version bigint,
  p_idempotency_key uuid
) returns table(outcome text,former_owner_member_id uuid,new_owner_member_id uuid)
language plpgsql security definer set search_path=''
as $$
declare
  actor_id uuid:=auth.uid();
  actor public.organization_members%rowtype;
  target public.organization_members%rowtype;
  prior private.membership_command_receipts%rowtype;
  request_digest text;
  result_outcome text;
  result_snapshot jsonb;
  result_digest text;
begin
  if actor_id is null then raise insufficient_privilege using message='authentication required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(concat_ws(':','membership',p_organization_id),0));
  select * into actor from public.organization_members member
  where member.organization_id=p_organization_id
    and member.user_id=actor_id
    and member.status='active'
  for update;
  if actor.id is null or actor.role not in('owner','administrator') then
    return query select 'forbidden',null::uuid,null::uuid;
    return;
  end if;
  if p_idempotency_key is null
    or p_expected_actor_version is null or p_expected_actor_version<0
    or p_expected_target_version is null or p_expected_target_version<0
  then
    return query select 'invalid',null::uuid,null::uuid;
    return;
  end if;
  request_digest:=encode(extensions.digest(convert_to(jsonb_build_object(
    'target_member_id',p_target_member_id,
    'expected_actor_version',p_expected_actor_version,
    'expected_target_version',p_expected_target_version
  )::text,'UTF8'),'sha256'),'hex');

  select * into prior from private.membership_command_receipts receipt
  where receipt.organization_id=p_organization_id
    and receipt.actor_user_id=actor_id
    and receipt.idempotency_key=p_idempotency_key;
  if found then
    if prior.command_kind<>'ownership_transfer'
      or prior.request_digest<>request_digest
      or prior.result_snapshot is null
      or prior.result_digest is null
      or prior.result_digest<>private.membership_result_digest(
        prior.organization_id,prior.actor_user_id,prior.idempotency_key,
        prior.command_kind,prior.request_digest,prior.result_snapshot
      )
      or prior.result_snapshot->>'outcome' is distinct from prior.outcome
      or prior.result_snapshot->>'outcome' not in('transferred','not_found','forbidden','conflict','invalid')
      or exists(
        select 1 from jsonb_object_keys(prior.result_snapshot) result_key
        where result_key not in('outcome','former_owner_member_id','new_owner_member_id')
      )
      or (
        prior.result_snapshot->>'former_owner_member_id' is not null
        and prior.result_snapshot->>'former_owner_member_id' !~
          '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      )
      or (
        prior.result_snapshot->>'new_owner_member_id' is not null
        and prior.result_snapshot->>'new_owner_member_id' !~
          '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      )
    then
      return query select 'conflict',null::uuid,null::uuid;
      return;
    end if;
    return query select
      prior.result_snapshot->>'outcome',
      (prior.result_snapshot->>'former_owner_member_id')::uuid,
      (prior.result_snapshot->>'new_owner_member_id')::uuid;
    return;
  end if;

  if actor.role<>'owner' then
    return query select 'forbidden',null::uuid,null::uuid;
    return;
  end if;
  select * into target from public.organization_members member
  where member.organization_id=p_organization_id and member.id=p_target_member_id
  for update;
  if target.id is null then result_outcome:='not_found';
  elsif target.status<>'active' or target.user_id=actor_id or target.role='owner' then result_outcome:='forbidden';
  elsif actor.version<>p_expected_actor_version or target.version<>p_expected_target_version then result_outcome:='conflict';
  else
    update public.organization_members member
    set role='owner',version=member.version+1
    where member.id=target.id;
    update public.organization_members member
    set role='administrator',version=member.version+1
    where member.id=actor.id;
    insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,details)
    values(p_organization_id,actor_id,'organization.ownership.transferred','organization_member',target.id,
      jsonb_build_object('formerOwnerMemberId',actor.id,'newOwnerMemberId',target.id));
    result_outcome:='transferred';
  end if;

  result_snapshot:=jsonb_build_object(
    'outcome',result_outcome,
    'former_owner_member_id',actor.id,
    'new_owner_member_id',target.id
  );
  result_digest:=private.membership_result_digest(
    p_organization_id,actor_id,p_idempotency_key,'ownership_transfer',request_digest,result_snapshot
  );
  insert into private.membership_command_receipts(
    organization_id,actor_user_id,idempotency_key,command_kind,request_digest,
    outcome,result_snapshot,result_digest
  ) values(
    p_organization_id,actor_id,p_idempotency_key,'ownership_transfer',request_digest,
    result_outcome,result_snapshot,result_digest
  );
  return query select result_outcome,actor.id,target.id;
end;
$$;

revoke all on function private.membership_result_digest(uuid,uuid,uuid,text,text,jsonb)
  from public,anon,authenticated,service_role;
revoke all on function private.prevent_membership_command_receipt_mutation()
  from public,anon,authenticated,service_role;
revoke all on function public.change_organization_member(uuid,uuid,text,text,bigint,uuid)
  from public,anon,authenticated,service_role;
revoke all on function public.transfer_organization_ownership(uuid,uuid,bigint,bigint,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.change_organization_member(uuid,uuid,text,text,bigint,uuid)
  to authenticated;
grant execute on function public.transfer_organization_ownership(uuid,uuid,bigint,bigint,uuid)
  to authenticated;
