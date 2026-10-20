-- Release placement-scoped numbers from the enrollment row's OLD owner and
-- distinguish conclusive NOWAIT contention from idempotency-key conflicts.

create or replace function public.release_stale_placement_numbers_trigger()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  released public.tryout_numbers%rowtype;
  released_at_value timestamptz;
  reason text;
  reparented boolean;
  session_changed boolean;
  group_changed boolean;
begin
  reparented:=tg_op<>'DELETE' and (
    old.organization_id is distinct from new.organization_id
    or old.tryout_id is distinct from new.tryout_id
    or old.registration_id is distinct from new.registration_id
  );
  session_changed:=tg_op='DELETE' or reparented
    or old.session_id is distinct from new.session_id;
  group_changed:=session_changed or old.group_id is distinct from new.group_id;

  if session_changed or group_changed then
    reason:=case when reparented then 'reparented' else 'placement_changed' end;
    released_at_value:=clock_timestamp();
    for released in
      update public.tryout_numbers number_assignment
      set released_at=released_at_value
      where number_assignment.organization_id=old.organization_id
        and number_assignment.tryout_id=old.tryout_id
        and number_assignment.registration_id=old.registration_id
        and number_assignment.released_at is null
        and (
          (session_changed and number_assignment.scope_kind='session'
            and number_assignment.session_id=old.session_id)
          or (group_changed and number_assignment.scope_kind='group'
            and number_assignment.session_id=old.session_id
            and number_assignment.group_id is not distinct from old.group_id)
        )
      returning number_assignment.*
    loop
      perform public.audit_checkin_number_release(
        released.id,released_at_value,reason,null
      );
    end loop;
  end if;
  return case when tg_op='DELETE' then old else new end;
end;
$$;

drop trigger release_stale_placement_numbers on public.session_enrollments;
create trigger release_stale_placement_numbers
after update of organization_id,tryout_id,registration_id,session_id,group_id
on public.session_enrollments
for each row execute function public.release_stale_placement_numbers_trigger();

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
  -- Parent ownership makes this plain read stable without inverting the lock order.
  select * into existing_enrollment from public.session_enrollments enrollment
  where enrollment.organization_id=p_organization_id and enrollment.registration_id=p_registration_id
    and enrollment.session_id=p_session_id;
  -- A legitimate group correction may update the existing tuple, but it must never
  -- wait while holding the parent. NOWAIT converts the only possible inverse edge
  -- into an explicit retry outcome, so the older enrollment mover can finish.
  if existing_enrollment.id is not null and existing_enrollment.group_id is distinct from p_group_id
  then
    begin
      select * into existing_enrollment from public.session_enrollments enrollment
      where enrollment.id=existing_enrollment.id for update nowait;
    exception when lock_not_available then
      -- No number, enrollment, receipt, QR, or audit mutation has happened yet.
      -- The same digest-bound request key is therefore safe to retry.
      return query select 'retryable_contention',null::uuid,null::timestamptz,null::integer,null::integer; return;
    end;
  end if;
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
  if existing_enrollment.id is null then
    insert into public.session_enrollments(organization_id,tryout_id,registration_id,session_id,group_id)
    values(p_organization_id,p_tryout_id,p_registration_id,p_session_id,p_group_id);
  elsif existing_enrollment.group_id is distinct from p_group_id then
    update public.session_enrollments set group_id=p_group_id,updated_at=clock_timestamp()
    where id=existing_enrollment.id;
  end if;
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
