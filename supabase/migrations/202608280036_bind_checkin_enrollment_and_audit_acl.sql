-- Scoped check-in authority follows the target registration's current placement,
-- not a caller-supplied sibling placement. Security history also has an exact ACL:
-- owner-executed writers append records while clients receive no mutation surface.

revoke all privileges on table
  public.audit_logs,
  public.platform_support_elevations
from public,anon,authenticated,service_role;
grant select on table public.audit_logs to authenticated;

create function public.can_operate_checkin_registration(
  p_organization_id uuid,
  p_tryout_id uuid,
  p_registration_id uuid,
  p_division_id uuid,
  p_session_id uuid,
  p_group_id uuid
) returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select public.is_active_organization_member(p_organization_id,array['owner','administrator'])
    or (
      public.is_active_organization_member(p_organization_id)
      and exists(
        select 1
        from public.tryout_staff_assignments assignment
        where assignment.organization_id=p_organization_id
          and assignment.tryout_id=p_tryout_id
          and assignment.user_id=auth.uid()
          and assignment.role in('director','checkin')
          and assignment.revoked_at is null
          and (assignment.expires_at is null or assignment.expires_at>clock_timestamp())
          and (
            assignment.scope_kind='tryout'
            or (assignment.scope_kind='division' and assignment.division_id=p_division_id)
            or (
              assignment.scope_kind='session'
              and assignment.session_id=p_session_id
              and not exists(
                select 1
                from public.session_enrollments stale
                left join public.tryout_sessions stale_session
                  on stale_session.organization_id=stale.organization_id
                  and stale_session.tryout_id=stale.tryout_id
                  and stale_session.id=stale.session_id
                where stale.organization_id=p_organization_id
                  and stale.tryout_id=p_tryout_id
                  and stale.registration_id=p_registration_id
                  and (stale_session.id is null or stale_session.division_id<>p_division_id)
              )
              and (
                not exists(
                  select 1 from public.session_enrollments enrollment
                  where enrollment.organization_id=p_organization_id
                    and enrollment.tryout_id=p_tryout_id
                    and enrollment.registration_id=p_registration_id
                )
                or exists(
                  select 1 from public.session_enrollments enrollment
                  where enrollment.organization_id=p_organization_id
                    and enrollment.tryout_id=p_tryout_id
                    and enrollment.registration_id=p_registration_id
                    and enrollment.session_id=p_session_id
                )
              )
            )
            or (
              assignment.scope_kind='group'
              and assignment.session_id=p_session_id
              and assignment.group_id=p_group_id
              and not exists(
                select 1
                from public.session_enrollments stale
                left join public.tryout_sessions stale_session
                  on stale_session.organization_id=stale.organization_id
                  and stale_session.tryout_id=stale.tryout_id
                  and stale_session.id=stale.session_id
                where stale.organization_id=p_organization_id
                  and stale.tryout_id=p_tryout_id
                  and stale.registration_id=p_registration_id
                  and (stale_session.id is null or stale_session.division_id<>p_division_id)
              )
              and (
                not exists(
                  select 1 from public.session_enrollments enrollment
                  where enrollment.organization_id=p_organization_id
                    and enrollment.tryout_id=p_tryout_id
                    and enrollment.registration_id=p_registration_id
                )
                or exists(
                  select 1 from public.session_enrollments enrollment
                  where enrollment.organization_id=p_organization_id
                    and enrollment.tryout_id=p_tryout_id
                    and enrollment.registration_id=p_registration_id
                    and enrollment.session_id=p_session_id
                    and enrollment.group_id=p_group_id
                )
              )
            )
          )
      )
    );
$$;

create function public.lock_session_enrollment_registration()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  if tg_op='INSERT' then
    perform registration.id from public.tryout_registrations registration
    where registration.organization_id=new.organization_id and registration.id=new.registration_id
    for update;
  elsif tg_op='DELETE' then
    perform registration.id from public.tryout_registrations registration
    where registration.organization_id=old.organization_id and registration.id=old.registration_id
    for update;
  else
    perform registration.id
    from public.tryout_registrations registration
    where (registration.organization_id,registration.id) in (
      (new.organization_id,new.registration_id),(old.organization_id,old.registration_id)
    )
    order by registration.organization_id,registration.id
    for update;
  end if;
  return case when tg_op='DELETE' then old else new end;
end;
$$;

create trigger a_lock_session_enrollment_registration
before insert or update or delete on public.session_enrollments
for each row execute function public.lock_session_enrollment_registration();

create or replace function public.assign_tryout_number(
  p_organization_id uuid,p_tryout_id uuid,p_registration_id uuid,p_division_id uuid,
  p_session_id uuid,p_group_id uuid,p_scope_kind text,p_requested integer
) returns table(outcome text,assignment_id uuid,assigned_number integer,next_available integer)
language plpgsql security definer set search_path='' as $$
declare registration public.tryout_registrations%rowtype;
begin
  if not public.can_operate_checkin(p_organization_id,p_tryout_id,p_division_id,p_session_id,p_group_id)
  then return query select 'forbidden',null::uuid,null::integer,null::integer; return; end if;
  if not exists(select 1 from public.tryouts tryout where tryout.organization_id=p_organization_id and tryout.id=p_tryout_id and tryout.status in('published','finalized'))
  then return query select 'invalid_placement',null::uuid,null::integer,null::integer; return; end if;
  select * into registration from public.tryout_registrations
  where organization_id=p_organization_id and tryout_id=p_tryout_id and id=p_registration_id for update;
  if registration.id is null or registration.division_id<>p_division_id
  then return query select 'invalid_registration',null::uuid,null::integer,null::integer; return; end if;
  perform enrollment.id from public.session_enrollments enrollment
  where enrollment.organization_id=p_organization_id and enrollment.tryout_id=p_tryout_id
    and enrollment.registration_id=p_registration_id
  order by enrollment.session_id,enrollment.id for update;
  if p_session_id is not null and not exists(select 1 from public.tryout_sessions session
      where session.organization_id=p_organization_id and session.tryout_id=p_tryout_id
        and session.division_id=registration.division_id and session.id=p_session_id)
    or p_group_id is not null and not exists(select 1 from public.session_groups checkin_group
      where checkin_group.organization_id=p_organization_id and checkin_group.tryout_id=p_tryout_id
        and checkin_group.division_id=registration.division_id and checkin_group.session_id=p_session_id
        and checkin_group.id=p_group_id)
  then return query select 'invalid_placement',null::uuid,null::integer,null::integer; return; end if;
  if not public.can_operate_checkin_registration(
    p_organization_id,p_tryout_id,p_registration_id,registration.division_id,p_session_id,p_group_id)
  then return query select 'forbidden',null::uuid,null::integer,null::integer; return; end if;
  if registration.status='withdrawn'
  then return query select 'withdrawn',null::uuid,null::integer,null::integer; return; end if;
  if registration.status='cancelled'
  then return query select 'cancelled',null::uuid,null::integer,null::integer; return; end if;
  return query select * from public.checkin_assign_number_internal(
    p_organization_id,p_tryout_id,p_registration_id,registration.division_id,p_session_id,p_group_id,
    case when p_scope_kind in('session','group') then p_session_id end,
    case when p_scope_kind='group' then p_group_id end,p_scope_kind,p_requested);
end;
$$;

create or replace function public.release_tryout_number(
  p_organization_id uuid,p_tryout_id uuid,p_registration_id uuid,
  p_session_id uuid,p_group_id uuid,p_reason text
) returns text language plpgsql security definer set search_path='' as $$
declare
  registration public.tryout_registrations%rowtype;
  released public.tryout_numbers%rowtype;
  caller_division uuid;
  released_count integer:=0;
  released_at_value timestamptz;
begin
  if p_reason not in('correction','withdrawal','cancellation','placement_changed','offboarding')
  then return 'invalid_request'; end if;
  select session.division_id into caller_division from public.tryout_sessions session
  where session.organization_id=p_organization_id and session.tryout_id=p_tryout_id and session.id=p_session_id;
  if caller_division is null or p_group_id is not null and not exists(select 1 from public.session_groups checkin_group
      where checkin_group.organization_id=p_organization_id and checkin_group.tryout_id=p_tryout_id
        and checkin_group.division_id=caller_division and checkin_group.session_id=p_session_id and checkin_group.id=p_group_id)
    or not public.can_operate_checkin(p_organization_id,p_tryout_id,caller_division,p_session_id,p_group_id)
  then return 'forbidden'; end if;
  select * into registration from public.tryout_registrations
  where organization_id=p_organization_id and tryout_id=p_tryout_id and id=p_registration_id for update;
  if registration.id is null then return 'not_found'; end if;
  perform enrollment.id from public.session_enrollments enrollment
  where enrollment.organization_id=p_organization_id and enrollment.tryout_id=p_tryout_id
    and enrollment.registration_id=p_registration_id
  order by enrollment.session_id,enrollment.id for update;
  if not exists(select 1 from public.tryout_sessions session where session.organization_id=p_organization_id
      and session.tryout_id=p_tryout_id and session.division_id=registration.division_id and session.id=p_session_id)
    or p_group_id is not null and not exists(select 1 from public.session_groups checkin_group
      where checkin_group.organization_id=p_organization_id and checkin_group.tryout_id=p_tryout_id
        and checkin_group.division_id=registration.division_id and checkin_group.session_id=p_session_id and checkin_group.id=p_group_id)
  then return 'invalid_placement'; end if;
  if not public.can_operate_checkin_registration(
    p_organization_id,p_tryout_id,p_registration_id,registration.division_id,p_session_id,p_group_id)
  then return 'forbidden'; end if;
  released_at_value:=clock_timestamp();
  for released in update public.tryout_numbers number_assignment set released_at=released_at_value
    where number_assignment.organization_id=p_organization_id and number_assignment.tryout_id=p_tryout_id
      and number_assignment.registration_id=p_registration_id and number_assignment.released_at is null
      and (number_assignment.scope_kind in('tryout','division')
        or (number_assignment.scope_kind='session' and number_assignment.session_id=p_session_id)
        or (number_assignment.scope_kind='group' and number_assignment.session_id=p_session_id
          and number_assignment.group_id is not distinct from p_group_id))
    returning number_assignment.*
  loop
    released_count:=released_count+1;
    perform public.audit_checkin_number_release(released.id,released_at_value,p_reason,auth.uid());
  end loop;
  if released_count=0 then return 'not_found'; end if;
  return 'released';
end;
$$;

create or replace function public.check_in_registration_v2(
  p_organization_id uuid,p_tryout_id uuid,p_registration_id uuid,p_session_id uuid,
  p_group_id uuid,p_idempotency_key text,p_scope_kind text,p_requested integer
) returns table(outcome text,receipt_id uuid,checked_in_at timestamptz,assigned_number integer,next_available integer)
language plpgsql security definer set search_path='' as $$
declare
  registration public.tryout_registrations%rowtype;
  existing public.checkins%rowtype;
  active_receipt public.checkins%rowtype;
  session_row public.tryout_sessions%rowtype;
  group_row public.session_groups%rowtype;
  number_result record;
  key_digest text;
  payload_digest text;
  receipt uuid;
  receipt_time timestamptz;
  existing_enrollment public.session_enrollments%rowtype;
begin
  if p_idempotency_key !~ '^[A-Za-z0-9_-]{24,200}$' or p_scope_kind not in('tryout','division','session','group')
    or (p_requested is not null and p_requested not between 1 and 9999)
  then return query select 'invalid_request',null::uuid,null::timestamptz,null::integer,null::integer; return; end if;
  select * into session_row from public.tryout_sessions session
  where session.organization_id=p_organization_id and session.tryout_id=p_tryout_id and session.id=p_session_id;
  if session_row.id is null or not public.can_operate_checkin(
    p_organization_id,p_tryout_id,session_row.division_id,p_session_id,p_group_id)
  then return query select 'forbidden',null::uuid,null::timestamptz,null::integer,null::integer; return; end if;
  if p_group_id is not null then
    select * into group_row from public.session_groups checkin_group
    where checkin_group.organization_id=p_organization_id and checkin_group.tryout_id=p_tryout_id
      and checkin_group.division_id=session_row.division_id and checkin_group.session_id=p_session_id
      and checkin_group.id=p_group_id;
    if group_row.id is null
    then return query select 'invalid_placement',null::uuid,null::timestamptz,null::integer,null::integer; return; end if;
  end if;
  if not exists(select 1 from public.tryouts tryout where tryout.organization_id=p_organization_id
    and tryout.id=p_tryout_id and tryout.status in('published','finalized'))
  then return query select 'invalid_placement',null::uuid,null::timestamptz,null::integer,null::integer; return; end if;

  key_digest:=encode(extensions.digest(p_idempotency_key,'sha256'),'hex');
  payload_digest:=encode(extensions.digest(concat_ws(':',p_organization_id,p_tryout_id,p_registration_id,
    p_session_id,coalesce(p_group_id::text,'-'),p_scope_kind,coalesce(p_requested::text,'auto')),'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtextextended(
    'checkin-key:'||p_organization_id||':'||p_tryout_id||':'||key_digest,0));
  select * into registration from public.tryout_registrations
  where organization_id=p_organization_id and tryout_id=p_tryout_id and id=p_registration_id for update;
  if registration.id is null or registration.division_id<>session_row.division_id
  then return query select 'invalid_registration',null::uuid,null::timestamptz,null::integer,null::integer; return; end if;
  perform enrollment.id from public.session_enrollments enrollment
  where enrollment.organization_id=p_organization_id and enrollment.tryout_id=p_tryout_id
    and enrollment.registration_id=p_registration_id
  order by enrollment.session_id,enrollment.id for update;
  if not public.can_operate_checkin_registration(
    p_organization_id,p_tryout_id,p_registration_id,registration.division_id,p_session_id,p_group_id)
  then return query select 'forbidden',null::uuid,null::timestamptz,null::integer,null::integer; return; end if;
  select * into existing from public.checkins checkin
  where checkin.organization_id=p_organization_id and checkin.tryout_id=p_tryout_id
    and checkin.idempotency_key_digest=key_digest;
  if existing.id is not null then
    if existing.request_payload_digest<>payload_digest
    then return query select 'conflict',null::uuid,null::timestamptz,null::integer,null::integer; return; end if;
    return query select existing.initial_outcome,existing.id,existing.checked_in_at,
      existing.assigned_number_snapshot,null::integer; return;
  end if;
  if registration.status='withdrawn'
  then return query select 'withdrawn',null::uuid,null::timestamptz,null::integer,null::integer; return; end if;
  if registration.status='cancelled'
  then return query select 'cancelled',null::uuid,null::timestamptz,null::integer,null::integer; return; end if;
  if public.registration_has_missing_information(registration.id)
  then return query select 'missing_information',null::uuid,null::timestamptz,null::integer,null::integer; return; end if;
  select * into active_receipt from public.checkins checkin
  where checkin.organization_id=p_organization_id and checkin.tryout_id=p_tryout_id
    and checkin.registration_id=p_registration_id and checkin.session_id=p_session_id
    and checkin.reversed_at is null;
  if active_receipt.id is not null
  then return query select 'already_checked_in',active_receipt.id,active_receipt.checked_in_at,
    active_receipt.assigned_number_snapshot,null::integer; return; end if;

  select * into session_row from public.tryout_sessions session
  where session.organization_id=p_organization_id and session.tryout_id=p_tryout_id
    and session.id=p_session_id for update;
  if p_group_id is not null then
    select * into group_row from public.session_groups checkin_group
    where checkin_group.organization_id=p_organization_id and checkin_group.tryout_id=p_tryout_id
      and checkin_group.division_id=registration.division_id and checkin_group.session_id=p_session_id
      and checkin_group.id=p_group_id for update;
  end if;
  select * into existing_enrollment from public.session_enrollments enrollment
  where enrollment.organization_id=p_organization_id and enrollment.registration_id=p_registration_id
    and enrollment.session_id=p_session_id for update;
  if existing_enrollment.id is null and session_row.capacity is not null and
    (select count(*) from public.session_enrollments enrollment where enrollment.organization_id=p_organization_id
      and enrollment.tryout_id=p_tryout_id and enrollment.session_id=p_session_id)>=session_row.capacity
  then return query select 'capacity',null::uuid,null::timestamptz,null::integer,null::integer; return; end if;
  if p_group_id is not null and existing_enrollment.group_id is distinct from p_group_id
    and group_row.capacity is not null and
    (select count(*) from public.session_enrollments enrollment where enrollment.organization_id=p_organization_id
      and enrollment.tryout_id=p_tryout_id and enrollment.session_id=p_session_id
      and enrollment.group_id=p_group_id)>=group_row.capacity
  then return query select 'capacity',null::uuid,null::timestamptz,null::integer,null::integer; return; end if;
  select * into number_result from public.checkin_assign_number_internal(
    p_organization_id,p_tryout_id,p_registration_id,registration.division_id,p_session_id,p_group_id,
    case when p_scope_kind in('session','group') then p_session_id end,
    case when p_scope_kind='group' then p_group_id end,p_scope_kind,p_requested);
  if number_result.outcome not in('assigned','replayed','corrected')
  then return query select number_result.outcome,null::uuid,null::timestamptz,null::integer,
    number_result.next_available; return; end if;
  insert into public.session_enrollments(organization_id,tryout_id,registration_id,session_id,group_id)
  values(p_organization_id,p_tryout_id,p_registration_id,p_session_id,p_group_id)
  on conflict(organization_id,registration_id,session_id)
  do update set group_id=excluded.group_id,updated_at=clock_timestamp();
  insert into public.checkins(organization_id,tryout_id,registration_id,session_id,group_id,
    tryout_number_id,assigned_number_snapshot,idempotency_key_digest,request_payload_digest,checked_in_by_user_id)
  values(p_organization_id,p_tryout_id,p_registration_id,p_session_id,p_group_id,
    number_result.assignment_id,number_result.assigned_number,key_digest,payload_digest,auth.uid())
  returning id,checkins.checked_in_at into receipt,receipt_time;
  update public.checkin_qr_tokens set used_at=clock_timestamp()
  where organization_id=p_organization_id and tryout_id=p_tryout_id and registration_id=p_registration_id
    and used_at is null and revoked_at is null;
  insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,details)
  values(p_organization_id,auth.uid(),'checkin.completed','checkin',receipt,
    jsonb_build_object('assignedNumber',number_result.assigned_number,'sessionId',p_session_id,'groupId',p_group_id));
  return query select 'checked_in',receipt,receipt_time,number_result.assigned_number,null::integer;
end;
$$;

create or replace function public.search_checkin_registrations_v2(
  p_organization_id uuid,p_tryout_id uuid,p_session_id uuid,p_group_id uuid,
  p_query text,p_limit integer,p_rate_key_hash text
) returns table(outcome text,registration_id uuid,athlete_name text,guardian_name text,division_name text,tryout_number integer,checkin_status text)
language plpgsql security definer set search_path='' as $$
declare query_text text; attempts_after integer; division uuid;
begin
  query_text:=public.canonical_import_text(trim(p_query));
  if auth.uid() is null or char_length(query_text) not between 2 and 120 or p_limit not between 1 and 25
    or p_rate_key_hash<>encode(extensions.digest(auth.uid()::text||':'||p_organization_id::text||':'||p_tryout_id::text||':checkin-search','sha256'),'hex')
  then return query select 'invalid_request',null::uuid,null::text,null::text,null::text,null::integer,null::text; return; end if;
  select session.division_id into division from public.tryout_sessions session
  where session.organization_id=p_organization_id and session.tryout_id=p_tryout_id and session.id=p_session_id;
  if division is null or not public.can_operate_checkin(p_organization_id,p_tryout_id,division,p_session_id,p_group_id)
  then return query select 'forbidden',null::uuid,null::text,null::text,null::text,null::integer,null::text; return; end if;
  insert into public.checkin_search_rate_counters(actor_user_id,organization_id,tryout_id,rate_key_hash,attempts,window_started_at,expires_at)
  values(auth.uid(),p_organization_id,p_tryout_id,p_rate_key_hash,1,clock_timestamp(),clock_timestamp()+interval '1 minute')
  on conflict(actor_user_id,organization_id,tryout_id,rate_key_hash) do update set
    attempts=case when public.checkin_search_rate_counters.expires_at<=clock_timestamp() then 1 else least(61,public.checkin_search_rate_counters.attempts+1) end,
    window_started_at=case when public.checkin_search_rate_counters.expires_at<=clock_timestamp() then clock_timestamp() else public.checkin_search_rate_counters.window_started_at end,
    expires_at=case when public.checkin_search_rate_counters.expires_at<=clock_timestamp() then clock_timestamp()+interval '1 minute' else public.checkin_search_rate_counters.expires_at end
  returning attempts into attempts_after;
  if attempts_after>60
  then return query select 'rate_limited',null::uuid,null::text,null::text,null::text,null::integer,null::text; return; end if;
  return query
  select 'ok',registration.id,athlete.given_name||' '||athlete.family_name,coalesce(guardian.name,''),checkin_division.name,
    (select number_assignment.number from public.tryout_numbers number_assignment
      where number_assignment.organization_id=registration.organization_id
        and number_assignment.tryout_id=registration.tryout_id
        and number_assignment.registration_id=registration.id and number_assignment.released_at is null
      order by number_assignment.assigned_at desc,number_assignment.id limit 1),
    case when registration.status='withdrawn' then 'withdrawn'
      when registration.status='cancelled' then 'cancelled'
      when public.registration_has_missing_information(registration.id) then 'missing_information'
      when exists(select 1 from public.checkins checkin where checkin.organization_id=registration.organization_id
        and checkin.tryout_id=registration.tryout_id and checkin.registration_id=registration.id
        and checkin.session_id=p_session_id and checkin.reversed_at is null) then 'checked_in'
      else 'ready' end
  from public.tryout_registrations registration
  join public.athletes athlete on athlete.organization_id=registration.organization_id and athlete.id=registration.athlete_id
  join public.tryout_divisions checkin_division on checkin_division.organization_id=registration.organization_id
    and checkin_division.tryout_id=registration.tryout_id and checkin_division.id=registration.division_id
  left join public.athlete_guardians athlete_guardian on athlete_guardian.organization_id=athlete.organization_id
    and athlete_guardian.athlete_id=athlete.id and athlete_guardian.is_primary_contact
  left join public.guardians guardian on guardian.organization_id=athlete_guardian.organization_id
    and guardian.id=athlete_guardian.guardian_id
  where registration.organization_id=p_organization_id and registration.tryout_id=p_tryout_id
    and registration.division_id=division
    and public.can_operate_checkin_registration(p_organization_id,p_tryout_id,registration.id,
      registration.division_id,p_session_id,p_group_id)
    and (
      strpos(public.canonical_import_text(athlete.given_name||' '||athlete.family_name),query_text)>0
      or strpos(public.canonical_import_text(coalesce(guardian.name,'')),query_text)>0
      or registration.id::text=trim(p_query)
      or (trim(p_query)~'^[0-9]{1,4}$' and exists(select 1 from public.tryout_numbers number_assignment
        where number_assignment.organization_id=registration.organization_id
          and number_assignment.tryout_id=registration.tryout_id
          and number_assignment.registration_id=registration.id and number_assignment.released_at is null
          and number_assignment.number=trim(p_query)::integer))
      or (athlete_guardian.communication_permitted and char_length(regexp_replace(p_query,'[^0-9]','','g'))>=7
        and strpos(regexp_replace(coalesce(guardian.phone,''),'[^0-9]','','g'),regexp_replace(p_query,'[^0-9]','','g'))>0)
      or (trim(p_query)~'^[0-9a-f]{64}$' and exists(select 1 from public.checkin_qr_tokens token
        where token.organization_id=registration.organization_id and token.tryout_id=registration.tryout_id
          and token.registration_id=registration.id
          and token.token_digest=encode(extensions.digest(trim(p_query),'sha256'),'hex')
          and token.used_at is null and token.revoked_at is null and token.expires_at>clock_timestamp()))
    )
  order by athlete.family_name,athlete.given_name,registration.id limit p_limit;
end;
$$;

revoke all on function
  public.can_operate_checkin_registration(uuid,uuid,uuid,uuid,uuid,uuid),
  public.lock_session_enrollment_registration()
from public,anon,authenticated,service_role;
