-- Close membership mutations behind execution-time-authorized, locked commands.

alter table public.organization_members
  add column version bigint not null default 0,
  add constraint organization_members_version_nonnegative check(version>=0);

create table private.membership_command_receipts(
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_user_id uuid not null references auth.users(id) on delete cascade,
  idempotency_key uuid not null,
  command_kind text not null,
  request_digest text not null,
  outcome text not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key(organization_id,actor_user_id,idempotency_key),
  constraint membership_command_receipts_kind_check
    check(command_kind in('member_change','ownership_transfer')),
  constraint membership_command_receipts_digest_check check(request_digest~'^[0-9a-f]{64}$'),
  constraint membership_command_receipts_outcome_check
    check(outcome in('updated','transferred','not_found','forbidden','conflict','invalid'))
);
alter table private.membership_command_receipts enable row level security;

drop policy if exists organization_members_manage_owner on public.organization_members;
drop policy if exists organization_members_manage_nonowner_administrator on public.organization_members;
drop policy if exists organization_invitations_select_administrator on public.organization_invitations;
drop policy if exists organization_invitations_insert_administrator on public.organization_invitations;
drop policy if exists organization_invitations_update_administrator on public.organization_invitations;
drop policy if exists organization_invitations_manage_administrator on public.organization_invitations;

create or replace function public.create_organization_invitation(
  p_organization_id uuid,
  p_email text,
  p_role text,
  p_token_digest text,
  p_expires_at timestamptz,
  p_invitation_id uuid
) returns table(outcome text,invitation_id uuid)
language plpgsql security definer set search_path=''
as $$
declare
  actor_id uuid:=auth.uid();
  normalized_email text:=lower(trim(coalesce(p_email,'')));
begin
  if actor_id is null then raise insufficient_privilege using message='authentication required'; end if;
  if not exists(
    select 1 from public.organization_members member
    where member.organization_id=p_organization_id and member.user_id=actor_id
      and member.status='active' and member.role in('owner','administrator')
  ) then return query select 'forbidden'::text,null::uuid; return; end if;
  if p_invitation_id is null or p_role not in('administrator','member')
    or normalized_email!~'^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
    or char_length(normalized_email)>254 or p_token_digest!~'^[0-9a-f]{64}$'
    or p_expires_at<=clock_timestamp() or p_expires_at>clock_timestamp()+interval '8 days'
  then return query select 'invalid'::text,null::uuid; return; end if;

  perform pg_advisory_xact_lock(hashtextextended(concat_ws(':','invitation',p_organization_id,normalized_email),0));
  if exists(
    select 1 from public.organization_invitations invitation
    where invitation.organization_id=p_organization_id and invitation.email=normalized_email
      and invitation.accepted_at is null and invitation.revoked_at is null
      and invitation.expires_at>clock_timestamp()
  ) then return query select 'conflict'::text,null::uuid; return; end if;

  begin
    insert into public.organization_invitations(
      id,organization_id,email,role,token_digest,expires_at,created_by_user_id
    ) values(p_invitation_id,p_organization_id,normalized_email,p_role,p_token_digest,p_expires_at,actor_id);
  exception when unique_violation then
    return query select 'conflict'::text,null::uuid; return;
  end;
  insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,details)
  values(p_organization_id,actor_id,'organization.invitation.created','organization_invitation',p_invitation_id,
    jsonb_build_object('role',p_role));
  return query select 'created'::text,p_invitation_id;
end;
$$;

create or replace function public.accept_organization_invitation(p_token_digest text)
returns table(outcome text,organization_id uuid,organization_slug text)
language plpgsql security definer set search_path=''
as $$
declare
  invitation public.organization_invitations%rowtype;
  organization public.organizations%rowtype;
  actor_id uuid:=auth.uid();
  actor_email text;
  actor_confirmed_at timestamptz;
  created_member_id uuid;
begin
  if actor_id is null then raise insufficient_privilege using message='authentication required'; end if;
  if p_token_digest is null or p_token_digest!~'^[0-9a-f]{64}$' then
    return query select 'invalid'::text,null::uuid,null::text; return;
  end if;
  select lower(trim(user_record.email::text)),user_record.email_confirmed_at
    into actor_email,actor_confirmed_at from auth.users user_record where user_record.id=actor_id;
  if actor_confirmed_at is null then
    return query select 'unverified'::text,null::uuid,null::text; return;
  end if;

  select * into invitation from public.organization_invitations
  where token_digest=p_token_digest for update;
  if not found or invitation.accepted_at is not null or invitation.revoked_at is not null then
    return query select 'invalid'::text,null::uuid,null::text; return;
  end if;
  if invitation.expires_at<=clock_timestamp() then
    return query select 'expired'::text,null::uuid,null::text; return;
  end if;
  if actor_email is null or lower(trim(invitation.email::text))<>actor_email then
    return query select 'wrong_email'::text,null::uuid,null::text; return;
  end if;
  if exists(select 1 from public.organization_members member
      where member.organization_id=invitation.organization_id and member.user_id=actor_id) then
    return query select 'duplicate_membership'::text,null::uuid,null::text; return;
  end if;

  insert into public.organization_members(organization_id,user_id,role,status)
  values(invitation.organization_id,actor_id,invitation.role,'active') returning id into created_member_id;
  update public.organization_invitations set accepted_at=clock_timestamp(),accepted_by_user_id=actor_id
    where id=invitation.id;
  insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,details)
  values(invitation.organization_id,actor_id,'organization.member.invitation_accepted','organization_member',created_member_id,
    jsonb_build_object('role',invitation.role));
  select * into organization from public.organizations item where item.id=invitation.organization_id;
  return query select 'accepted'::text,organization.id,organization.slug;
end;
$$;

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
  request_digest text:=encode(extensions.digest(convert_to(concat_ws('|',p_member_id,p_role,p_status,p_expected_version),'UTF8'),'sha256'),'hex');
  result_outcome text;
begin
  if actor_id is null then raise insufficient_privilege using message='authentication required'; end if;
  if p_idempotency_key is null then return query select 'invalid',null::uuid,null::text,null::text,null::bigint; return; end if;
  perform pg_advisory_xact_lock(hashtextextended(concat_ws(':','membership',p_organization_id),0));
  select * into prior from private.membership_command_receipts receipt
    where receipt.organization_id=p_organization_id and receipt.actor_user_id=actor_id
      and receipt.idempotency_key=p_idempotency_key;
  if found then
    if prior.command_kind<>'member_change' or prior.request_digest<>request_digest then
      return query select 'conflict',null::uuid,null::text,null::text,null::bigint; return;
    end if;
    select * into target from public.organization_members member
      where member.organization_id=p_organization_id and member.id=p_member_id;
    return query select prior.outcome,target.id,target.role,target.status,target.version; return;
  end if;

  select * into actor from public.organization_members member
    where member.organization_id=p_organization_id and member.user_id=actor_id and member.status='active' for update;
  select * into target from public.organization_members member
    where member.organization_id=p_organization_id and member.id=p_member_id for update;
  if actor.id is null or target.id is null then result_outcome:='not_found';
  elsif target.user_id=actor_id or target.role='owner' then result_outcome:='forbidden';
  elsif p_role not in('administrator','member') or p_status not in('active','disabled') then result_outcome:='invalid';
  elsif target.version<>p_expected_version then result_outcome:='conflict';
  elsif actor.role='administrator' and (target.role<>'member' or p_role<>'member') then result_outcome:='forbidden';
  elsif actor.role not in('owner','administrator') then result_outcome:='forbidden';
  else
    old_role:=target.role;
    old_status:=target.status;
    update public.organization_members member set role=p_role,status=p_status,version=member.version+1
      where member.id=target.id returning * into target;
    result_outcome:='updated';
  end if;

  insert into private.membership_command_receipts(
    organization_id,actor_user_id,idempotency_key,command_kind,request_digest,outcome
  ) values(p_organization_id,actor_id,p_idempotency_key,'member_change',request_digest,result_outcome);
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
  request_digest text:=encode(extensions.digest(convert_to(concat_ws('|',p_target_member_id,p_expected_actor_version,p_expected_target_version),'UTF8'),'sha256'),'hex');
  result_outcome text;
begin
  if actor_id is null then raise insufficient_privilege using message='authentication required'; end if;
  if p_idempotency_key is null then return query select 'invalid',null::uuid,null::uuid; return; end if;
  perform pg_advisory_xact_lock(hashtextextended(concat_ws(':','membership',p_organization_id),0));
  select * into prior from private.membership_command_receipts receipt
    where receipt.organization_id=p_organization_id and receipt.actor_user_id=actor_id
      and receipt.idempotency_key=p_idempotency_key;
  if found then
    if prior.command_kind<>'ownership_transfer' or prior.request_digest<>request_digest then
      return query select 'conflict',null::uuid,null::uuid; return;
    end if;
    return query select prior.outcome,
      (select member.id from public.organization_members member where member.organization_id=p_organization_id and member.user_id=actor_id),
      p_target_member_id;
    return;
  end if;
  select * into actor from public.organization_members member
    where member.organization_id=p_organization_id and member.user_id=actor_id for update;
  select * into target from public.organization_members member
    where member.organization_id=p_organization_id and member.id=p_target_member_id for update;
  if actor.id is null or target.id is null then result_outcome:='not_found';
  elsif actor.role<>'owner' or actor.status<>'active' or target.status<>'active'
    or target.user_id=actor_id or target.role='owner' then result_outcome:='forbidden';
  elsif actor.version<>p_expected_actor_version or target.version<>p_expected_target_version then result_outcome:='conflict';
  else
    update public.organization_members member set role='owner',version=member.version+1 where member.id=target.id;
    update public.organization_members member set role='administrator',version=member.version+1 where member.id=actor.id;
    insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,details)
    values(p_organization_id,actor_id,'organization.ownership.transferred','organization_member',target.id,
      jsonb_build_object('formerOwnerMemberId',actor.id,'newOwnerMemberId',target.id));
    result_outcome:='transferred';
  end if;
  insert into private.membership_command_receipts(
    organization_id,actor_user_id,idempotency_key,command_kind,request_digest,outcome
  ) values(p_organization_id,actor_id,p_idempotency_key,'ownership_transfer',request_digest,result_outcome);
  return query select result_outcome,actor.id,target.id;
end;
$$;

revoke all on table private.membership_command_receipts from public,anon,authenticated,service_role;
revoke insert,update,delete on table public.organization_members from public,anon,authenticated,service_role;
revoke all on table public.organization_invitations from public,anon,authenticated,service_role;
revoke all on function public.create_organization_invitation(uuid,text,text,text,timestamptz,uuid) from public,anon,authenticated,service_role;
revoke all on function public.accept_organization_invitation(text) from public,anon,authenticated,service_role;
revoke all on function public.change_organization_member(uuid,uuid,text,text,bigint,uuid) from public,anon,authenticated,service_role;
revoke all on function public.transfer_organization_ownership(uuid,uuid,bigint,bigint,uuid) from public,anon,authenticated,service_role;
grant execute on function public.create_organization_invitation(uuid,text,text,text,timestamptz,uuid) to authenticated;
grant execute on function public.accept_organization_invitation(text) to authenticated;
grant execute on function public.change_organization_member(uuid,uuid,text,text,bigint,uuid) to authenticated;
grant execute on function public.transfer_organization_ownership(uuid,uuid,bigint,bigint,uuid) to authenticated;
