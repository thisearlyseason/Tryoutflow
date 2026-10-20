-- Reject nullable required director-flag inputs before authorization or mutation.

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
  if p_organization_id is null or p_tryout_id is null or p_division_id is null
    or p_registration_id is null or p_session_id is null
    or p_action is null or p_flag_type is null
    or p_action not in ('upsert','revoke')
    or p_flag_type not in ('needs_another_look','injury_concern','eligibility_review')
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
