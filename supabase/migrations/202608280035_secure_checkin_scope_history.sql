-- Bind check-in mutations to the locked registration, preserve receipt history,
-- and make automatic number releases observable through append-only audit rows.

alter table public.audit_logs
  add column details jsonb not null default '{}'::jsonb,
  add constraint audit_logs_details_object_check check(jsonb_typeof(details)='object');

alter table public.tryout_sessions
  add constraint tryout_sessions_division_identity_key
  unique(organization_id,tryout_id,division_id,id);

alter table public.session_groups add column division_id uuid;
update public.session_groups g set division_id=s.division_id
from public.tryout_sessions s
where s.organization_id=g.organization_id and s.tryout_id=g.tryout_id and s.id=g.session_id;
alter table public.session_groups
  alter column division_id set not null,
  add constraint session_groups_division_session_fkey
    foreign key(organization_id,tryout_id,division_id,session_id)
    references public.tryout_sessions(organization_id,tryout_id,division_id,id) on delete cascade,
  add constraint session_groups_division_identity_key
    unique(organization_id,tryout_id,division_id,session_id,id);

create function public.sync_session_group_division() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  select s.division_id into new.division_id
  from public.tryout_sessions s
  where s.organization_id=new.organization_id and s.tryout_id=new.tryout_id and s.id=new.session_id;
  if new.division_id is null then raise foreign_key_violation using message='session group parent session not found'; end if;
  return new;
end; $$;
create trigger sync_session_group_division before insert or update of organization_id,tryout_id,session_id
on public.session_groups for each row execute function public.sync_session_group_division();

alter table public.tryout_numbers
  add constraint tryout_numbers_division_session_fkey
    foreign key(organization_id,tryout_id,division_id,session_id)
    references public.tryout_sessions(organization_id,tryout_id,division_id,id) on delete restrict,
  add constraint tryout_numbers_division_group_fkey
    foreign key(organization_id,tryout_id,division_id,session_id,group_id)
    references public.session_groups(organization_id,tryout_id,division_id,session_id,id) on delete restrict;

alter table public.checkins add column assigned_number_snapshot integer;
update public.checkins c set assigned_number_snapshot=n.number
from public.tryout_numbers n where n.id=c.tryout_number_id;
alter table public.checkins
  alter column assigned_number_snapshot set not null,
  add constraint checkins_assigned_number_snapshot_check check(assigned_number_snapshot between 1 and 9999);

create unique index checkin_qr_one_active_registration_key
  on public.checkin_qr_tokens(organization_id,tryout_id,registration_id)
  where used_at is null and revoked_at is null;

create function public.audit_checkin_number_release(
  p_number_id uuid,p_released_at timestamptz,p_reason text,p_actor_user_id uuid
) returns void language plpgsql security definer set search_path='' as $$
declare n public.tryout_numbers%rowtype;
begin
  select * into strict n from public.tryout_numbers where id=p_number_id;
  insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,details)
  values(n.organization_id,p_actor_user_id,'checkin.number_released','tryout_number',n.id,
    jsonb_build_object(
      'before',jsonb_build_object('releasedAt',null,'number',n.number),
      'after',jsonb_build_object('releasedAt',p_released_at,'number',n.number),
      'scope',jsonb_build_object('kind',n.scope_kind,'tryoutId',n.tryout_id,'divisionId',n.division_id,
        'sessionId',n.session_id,'groupId',n.group_id),
      'reason',p_reason,'registrationId',n.registration_id));
end; $$;

create or replace function public.checkin_assign_number_internal(
  p_organization_id uuid,p_tryout_id uuid,p_registration_id uuid,p_division_id uuid,
  p_authorization_session_id uuid,p_authorization_group_id uuid,
  p_number_session_id uuid,p_number_group_id uuid,p_scope_kind text,p_requested integer
) returns table(outcome text,assignment_id uuid,assigned_number integer,next_available integer)
language plpgsql security definer set search_path='' as $$
declare
  selected integer; existing public.tryout_numbers%rowtype; created public.tryout_numbers%rowtype;
  registration public.tryout_registrations%rowtype; lock_scope text; released_at_value timestamptz;
begin
  if p_scope_kind not in('tryout','division','session','group')
    or (p_requested is not null and p_requested not between 1 and 9999)
  then return query select 'invalid_request',null::uuid,null::integer,null::integer; return; end if;

  select * into registration from public.tryout_registrations r
  where r.organization_id=p_organization_id and r.tryout_id=p_tryout_id and r.id=p_registration_id for update;
  if registration.id is null or registration.division_id<>p_division_id
  then return query select 'invalid_registration',null::uuid,null::integer,null::integer; return; end if;
  if p_authorization_session_id is not null and not exists(
    select 1 from public.tryout_sessions s where s.organization_id=p_organization_id and s.tryout_id=p_tryout_id
      and s.division_id=registration.division_id and s.id=p_authorization_session_id)
    or p_authorization_group_id is not null and not exists(
      select 1 from public.session_groups g where g.organization_id=p_organization_id and g.tryout_id=p_tryout_id
        and g.division_id=registration.division_id and g.session_id=p_authorization_session_id and g.id=p_authorization_group_id)
  then return query select 'invalid_placement',null::uuid,null::integer,null::integer; return; end if;
  if not public.can_operate_checkin(p_organization_id,p_tryout_id,registration.division_id,p_authorization_session_id,p_authorization_group_id)
  then return query select 'forbidden',null::uuid,null::integer,null::integer; return; end if;
  if (p_scope_kind in('tryout','division') and (p_number_session_id is not null or p_number_group_id is not null))
    or (p_scope_kind='session' and (p_number_session_id is null or p_number_group_id is not null))
    or (p_scope_kind='group' and (p_number_session_id is null or p_number_group_id is null))
    or (p_number_session_id is not null and not exists(
      select 1 from public.tryout_sessions s where s.organization_id=p_organization_id and s.tryout_id=p_tryout_id
        and s.division_id=registration.division_id and s.id=p_number_session_id))
    or (p_number_group_id is not null and not exists(
      select 1 from public.session_groups g where g.organization_id=p_organization_id and g.tryout_id=p_tryout_id
        and g.division_id=registration.division_id and g.session_id=p_number_session_id and g.id=p_number_group_id))
  then return query select 'invalid_placement',null::uuid,null::integer,null::integer; return; end if;

  lock_scope:=concat_ws(':','checkin-number',p_organization_id,p_tryout_id,p_scope_kind,
    case when p_scope_kind<>'tryout' then registration.division_id end,
    case when p_scope_kind in('session','group') then p_number_session_id end,
    case when p_scope_kind='group' then p_number_group_id end);
  perform pg_advisory_xact_lock(hashtextextended(lock_scope,0));
  select * into existing from public.tryout_numbers n
  where n.organization_id=p_organization_id and n.tryout_id=p_tryout_id and n.registration_id=p_registration_id
    and n.scope_kind=p_scope_kind and n.released_at is null
    and (p_scope_kind='tryout' or n.division_id=registration.division_id)
    and (p_scope_kind not in('session','group') or n.session_id=p_number_session_id)
    and (p_scope_kind<>'group' or n.group_id=p_number_group_id) for update;
  select candidate into selected from generate_series(1,9999) candidate where not exists(
    select 1 from public.tryout_numbers n where n.organization_id=p_organization_id and n.tryout_id=p_tryout_id
      and n.scope_kind=p_scope_kind and n.number=candidate and n.released_at is null
      and (p_scope_kind='tryout' or n.division_id=registration.division_id)
      and (p_scope_kind not in('session','group') or n.session_id=p_number_session_id)
      and (p_scope_kind<>'group' or n.group_id=p_number_group_id)
  ) order by candidate limit 1;
  if existing.id is not null and (p_requested is null or p_requested=existing.number)
  then return query select 'replayed',existing.id,existing.number,selected; return; end if;
  if p_requested is not null and exists(
    select 1 from public.tryout_numbers n where n.organization_id=p_organization_id and n.tryout_id=p_tryout_id
      and n.scope_kind=p_scope_kind and n.number=p_requested and n.released_at is null and n.id is distinct from existing.id
      and (p_scope_kind='tryout' or n.division_id=registration.division_id)
      and (p_scope_kind not in('session','group') or n.session_id=p_number_session_id)
      and (p_scope_kind<>'group' or n.group_id=p_number_group_id)
  ) then return query select 'number_conflict',null::uuid,null::integer,selected; return; end if;
  selected:=coalesce(p_requested,selected);
  if selected is null then return query select 'exhausted',null::uuid,null::integer,null::integer; return; end if;

  if existing.id is not null then
    released_at_value:=clock_timestamp();
    update public.tryout_numbers set released_at=released_at_value where id=existing.id;
    perform public.audit_checkin_number_release(existing.id,released_at_value,'correction',auth.uid());
  end if;
  insert into public.tryout_numbers(organization_id,tryout_id,registration_id,division_id,session_id,group_id,scope_kind,number,assigned_by_user_id)
  values(p_organization_id,p_tryout_id,p_registration_id,registration.division_id,p_number_session_id,p_number_group_id,p_scope_kind,selected,auth.uid())
  returning * into created;
  insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,details)
  values(p_organization_id,auth.uid(),'checkin.number_assigned','tryout_number',created.id,
    jsonb_build_object('before',null,'after',jsonb_build_object('number',created.number,'releasedAt',null),
      'scope',jsonb_build_object('kind',created.scope_kind,'tryoutId',created.tryout_id,'divisionId',created.division_id,
        'sessionId',created.session_id,'groupId',created.group_id),'reason',case when existing.id is null then 'assignment' else 'correction' end,
      'registrationId',created.registration_id,'replacesNumberId',existing.id));
  return query select case when existing.id is null then 'assigned' else 'corrected' end,created.id,selected,null::integer;
end; $$;

create or replace function public.assign_tryout_number(
  p_organization_id uuid,p_tryout_id uuid,p_registration_id uuid,p_division_id uuid,
  p_session_id uuid,p_group_id uuid,p_scope_kind text,p_requested integer
) returns table(outcome text,assignment_id uuid,assigned_number integer,next_available integer)
language plpgsql security definer set search_path='' as $$
declare r public.tryout_registrations%rowtype;
begin
  -- A caller-placement precheck prevents registration IDs from becoming an
  -- authorization oracle.  The internal command re-authorizes after locking
  -- and deriving the registration's actual division before any mutation.
  if not public.can_operate_checkin(p_organization_id,p_tryout_id,p_division_id,p_session_id,p_group_id)
  then return query select 'forbidden',null::uuid,null::integer,null::integer; return; end if;
  if not exists(select 1 from public.tryouts t where t.organization_id=p_organization_id and t.id=p_tryout_id and t.status in('published','finalized'))
  then return query select 'invalid_placement',null::uuid,null::integer,null::integer; return; end if;
  select * into r from public.tryout_registrations
    where organization_id=p_organization_id and tryout_id=p_tryout_id and id=p_registration_id for update;
  if r.id is null or r.division_id<>p_division_id then return query select 'invalid_registration',null::uuid,null::integer,null::integer; return; end if;
  if p_session_id is not null and not exists(select 1 from public.tryout_sessions s
      where s.organization_id=p_organization_id and s.tryout_id=p_tryout_id and s.division_id=r.division_id and s.id=p_session_id)
    or p_group_id is not null and not exists(select 1 from public.session_groups g
      where g.organization_id=p_organization_id and g.tryout_id=p_tryout_id and g.division_id=r.division_id and g.session_id=p_session_id and g.id=p_group_id)
  then return query select 'invalid_placement',null::uuid,null::integer,null::integer; return; end if;
  if not public.can_operate_checkin(p_organization_id,p_tryout_id,r.division_id,p_session_id,p_group_id)
  then return query select 'forbidden',null::uuid,null::integer,null::integer; return; end if;
  if r.status='withdrawn' then return query select 'withdrawn',null::uuid,null::integer,null::integer; return; end if;
  if r.status='cancelled' then return query select 'cancelled',null::uuid,null::integer,null::integer; return; end if;
  return query select * from public.checkin_assign_number_internal(
    p_organization_id,p_tryout_id,p_registration_id,r.division_id,p_session_id,p_group_id,
    case when p_scope_kind in('session','group') then p_session_id end,
    case when p_scope_kind='group' then p_group_id end,p_scope_kind,p_requested);
end; $$;

create or replace function public.release_tryout_number(
  p_organization_id uuid,p_tryout_id uuid,p_registration_id uuid,
  p_session_id uuid,p_group_id uuid,p_reason text
) returns text language plpgsql security definer set search_path='' as $$
declare r public.tryout_registrations%rowtype; released public.tryout_numbers%rowtype; caller_division uuid; released_count integer:=0; released_at_value timestamptz;
begin
  if p_reason not in('correction','withdrawal','cancellation','placement_changed','offboarding') then return 'invalid_request'; end if;
  select s.division_id into caller_division from public.tryout_sessions s
  where s.organization_id=p_organization_id and s.tryout_id=p_tryout_id and s.id=p_session_id;
  if caller_division is null or p_group_id is not null and not exists(select 1 from public.session_groups g
      where g.organization_id=p_organization_id and g.tryout_id=p_tryout_id and g.division_id=caller_division and g.session_id=p_session_id and g.id=p_group_id)
    or not public.can_operate_checkin(p_organization_id,p_tryout_id,caller_division,p_session_id,p_group_id)
  then return 'forbidden'; end if;
  select * into r from public.tryout_registrations where organization_id=p_organization_id and tryout_id=p_tryout_id and id=p_registration_id for update;
  if r.id is null then return 'not_found'; end if;
  if not exists(select 1 from public.tryout_sessions s where s.organization_id=p_organization_id and s.tryout_id=p_tryout_id and s.division_id=r.division_id and s.id=p_session_id)
    or p_group_id is not null and not exists(select 1 from public.session_groups g where g.organization_id=p_organization_id and g.tryout_id=p_tryout_id and g.division_id=r.division_id and g.session_id=p_session_id and g.id=p_group_id)
  then return 'invalid_placement'; end if;
  if not public.can_operate_checkin(p_organization_id,p_tryout_id,r.division_id,p_session_id,p_group_id) then return 'forbidden'; end if;
  released_at_value:=clock_timestamp();
  for released in update public.tryout_numbers n set released_at=released_at_value
    where n.organization_id=p_organization_id and n.tryout_id=p_tryout_id and n.registration_id=p_registration_id and n.released_at is null
      and (n.scope_kind in('tryout','division') or (n.scope_kind='session' and n.session_id=p_session_id)
        or (n.scope_kind='group' and n.session_id=p_session_id and n.group_id is not distinct from p_group_id))
    returning n.*
  loop
    released_count:=released_count+1;
    perform public.audit_checkin_number_release(released.id,released_at_value,p_reason,auth.uid());
  end loop;
  if released_count=0 then return 'not_found'; end if;
  return 'released';
end; $$;

create or replace function public.release_registration_numbers_trigger() returns trigger
language plpgsql security definer set search_path='' as $$
declare released public.tryout_numbers%rowtype; released_at_value timestamptz; reason text;
begin
  if new.status in('withdrawn','cancelled') and old.status is distinct from new.status then
    reason:=case new.status when 'withdrawn' then 'withdrawal' else 'cancellation' end;
    released_at_value:=clock_timestamp();
    for released in update public.tryout_numbers set released_at=released_at_value
      where organization_id=new.organization_id and tryout_id=new.tryout_id and registration_id=new.id and released_at is null returning *
    loop perform public.audit_checkin_number_release(released.id,released_at_value,reason,null); end loop;
  end if;
  return new;
end; $$;

create or replace function public.release_stale_placement_numbers_trigger() returns trigger
language plpgsql security definer set search_path='' as $$
declare source public.session_enrollments%rowtype; released public.tryout_numbers%rowtype; released_at_value timestamptz;
begin
  source:=case when tg_op='DELETE' then old else new end;
  if tg_op='DELETE' or old.session_id is distinct from new.session_id or old.group_id is distinct from new.group_id then
    released_at_value:=clock_timestamp();
    for released in update public.tryout_numbers set released_at=released_at_value
      where organization_id=source.organization_id and tryout_id=source.tryout_id and registration_id=source.registration_id
        and released_at is null and ((scope_kind='session' and session_id=old.session_id)
          or (scope_kind='group' and session_id=old.session_id and group_id is not distinct from old.group_id)) returning *
    loop perform public.audit_checkin_number_release(released.id,released_at_value,'placement_changed',null); end loop;
  end if;
  return case when tg_op='DELETE' then old else new end;
end; $$;

create or replace function public.check_in_registration_v2(
  p_organization_id uuid,p_tryout_id uuid,p_registration_id uuid,p_session_id uuid,
  p_group_id uuid,p_idempotency_key text,p_scope_kind text,p_requested integer
) returns table(outcome text,receipt_id uuid,checked_in_at timestamptz,assigned_number integer,next_available integer)
language plpgsql security definer set search_path='' as $$
declare
  r public.tryout_registrations%rowtype; existing public.checkins%rowtype; active_receipt public.checkins%rowtype;
  session_row public.tryout_sessions%rowtype; group_row public.session_groups%rowtype; number_result record;
  key_digest text; payload_digest text; receipt uuid; receipt_time timestamptz; existing_enrollment public.session_enrollments%rowtype;
begin
  if p_idempotency_key !~ '^[A-Za-z0-9_-]{24,200}$' or p_scope_kind not in('tryout','division','session','group')
    or (p_requested is not null and p_requested not between 1 and 9999)
  then return query select 'invalid_request',null::uuid,null::timestamptz,null::integer,null::integer; return; end if;
  select * into session_row from public.tryout_sessions s where s.organization_id=p_organization_id and s.tryout_id=p_tryout_id and s.id=p_session_id;
  if session_row.id is null or not public.can_operate_checkin(p_organization_id,p_tryout_id,session_row.division_id,p_session_id,p_group_id)
  then return query select 'forbidden',null::uuid,null::timestamptz,null::integer,null::integer; return; end if;
  if p_group_id is not null then
    select * into group_row from public.session_groups g where g.organization_id=p_organization_id and g.tryout_id=p_tryout_id
      and g.division_id=session_row.division_id and g.session_id=p_session_id and g.id=p_group_id;
    if group_row.id is null then return query select 'invalid_placement',null::uuid,null::timestamptz,null::integer,null::integer; return; end if;
  end if;
  if not exists(select 1 from public.tryouts t where t.organization_id=p_organization_id and t.id=p_tryout_id and t.status in('published','finalized'))
  then return query select 'invalid_placement',null::uuid,null::timestamptz,null::integer,null::integer; return; end if;
  key_digest:=encode(extensions.digest(p_idempotency_key,'sha256'),'hex');
  payload_digest:=encode(extensions.digest(concat_ws(':',p_organization_id,p_tryout_id,p_registration_id,p_session_id,coalesce(p_group_id::text,'-'),p_scope_kind,coalesce(p_requested::text,'auto')),'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtextextended('checkin-key:'||p_organization_id||':'||p_tryout_id||':'||key_digest,0));
  select * into existing from public.checkins c where c.organization_id=p_organization_id and c.tryout_id=p_tryout_id and c.idempotency_key_digest=key_digest;
  if existing.id is not null then
    if existing.request_payload_digest<>payload_digest then return query select 'conflict',null::uuid,null::timestamptz,null::integer,null::integer; return; end if;
    return query select existing.initial_outcome,existing.id,existing.checked_in_at,existing.assigned_number_snapshot,null::integer; return;
  end if;
  select * into r from public.tryout_registrations where organization_id=p_organization_id and tryout_id=p_tryout_id and id=p_registration_id for update;
  if r.id is null or r.division_id<>session_row.division_id then return query select 'invalid_registration',null::uuid,null::timestamptz,null::integer,null::integer; return; end if;
  if r.status='withdrawn' then return query select 'withdrawn',null::uuid,null::timestamptz,null::integer,null::integer; return; end if;
  if r.status='cancelled' then return query select 'cancelled',null::uuid,null::timestamptz,null::integer,null::integer; return; end if;
  if public.registration_has_missing_information(r.id) then return query select 'missing_information',null::uuid,null::timestamptz,null::integer,null::integer; return; end if;
  select * into active_receipt from public.checkins c where c.organization_id=p_organization_id and c.tryout_id=p_tryout_id and c.registration_id=p_registration_id and c.session_id=p_session_id and c.reversed_at is null;
  if active_receipt.id is not null then return query select 'already_checked_in',active_receipt.id,active_receipt.checked_in_at,active_receipt.assigned_number_snapshot,null::integer; return; end if;
  select * into session_row from public.tryout_sessions s where s.organization_id=p_organization_id and s.tryout_id=p_tryout_id and s.id=p_session_id for update;
  if p_group_id is not null then select * into group_row from public.session_groups g where g.organization_id=p_organization_id and g.tryout_id=p_tryout_id and g.division_id=r.division_id and g.session_id=p_session_id and g.id=p_group_id for update; end if;
  select * into existing_enrollment from public.session_enrollments e where e.organization_id=p_organization_id and e.registration_id=p_registration_id and e.session_id=p_session_id for update;
  if existing_enrollment.id is null and session_row.capacity is not null and
    (select count(*) from public.session_enrollments e where e.organization_id=p_organization_id and e.tryout_id=p_tryout_id and e.session_id=p_session_id)>=session_row.capacity
  then return query select 'capacity',null::uuid,null::timestamptz,null::integer,null::integer; return; end if;
  if p_group_id is not null and existing_enrollment.group_id is distinct from p_group_id and group_row.capacity is not null and
    (select count(*) from public.session_enrollments e where e.organization_id=p_organization_id and e.tryout_id=p_tryout_id and e.session_id=p_session_id and e.group_id=p_group_id)>=group_row.capacity
  then return query select 'capacity',null::uuid,null::timestamptz,null::integer,null::integer; return; end if;
  select * into number_result from public.checkin_assign_number_internal(p_organization_id,p_tryout_id,p_registration_id,r.division_id,p_session_id,p_group_id,
    case when p_scope_kind in('session','group') then p_session_id end,case when p_scope_kind='group' then p_group_id end,p_scope_kind,p_requested);
  if number_result.outcome not in('assigned','replayed','corrected') then return query select number_result.outcome,null::uuid,null::timestamptz,null::integer,number_result.next_available; return; end if;
  insert into public.session_enrollments(organization_id,tryout_id,registration_id,session_id,group_id)
  values(p_organization_id,p_tryout_id,p_registration_id,p_session_id,p_group_id)
  on conflict(organization_id,registration_id,session_id) do update set group_id=excluded.group_id,updated_at=clock_timestamp();
  insert into public.checkins(organization_id,tryout_id,registration_id,session_id,group_id,tryout_number_id,assigned_number_snapshot,idempotency_key_digest,request_payload_digest,checked_in_by_user_id)
  values(p_organization_id,p_tryout_id,p_registration_id,p_session_id,p_group_id,number_result.assignment_id,number_result.assigned_number,key_digest,payload_digest,auth.uid())
  returning id,checkins.checked_in_at into receipt,receipt_time;
  update public.checkin_qr_tokens set used_at=clock_timestamp() where organization_id=p_organization_id and tryout_id=p_tryout_id and registration_id=p_registration_id and used_at is null and revoked_at is null;
  insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,details)
  values(p_organization_id,auth.uid(),'checkin.completed','checkin',receipt,jsonb_build_object('assignedNumber',number_result.assigned_number,'sessionId',p_session_id,'groupId',p_group_id));
  return query select 'checked_in',receipt,receipt_time,number_result.assigned_number,null::integer;
end; $$;

create or replace function public.issue_checkin_qr_token(p_organization_id uuid,p_tryout_id uuid,p_registration_id uuid)
returns text language plpgsql security definer set search_path='' as $$
declare raw text; registration public.tryout_registrations%rowtype;
begin
  if not public.is_active_organization_member(p_organization_id,array['owner','administrator'])
    or not exists(select 1 from public.tryouts t where t.organization_id=p_organization_id and t.id=p_tryout_id and t.status in('published','finalized'))
  then return null; end if;
  select * into registration from public.tryout_registrations r where r.organization_id=p_organization_id and r.tryout_id=p_tryout_id and r.id=p_registration_id for update;
  if registration.id is null or registration.status<>'submitted' then return null; end if;
  raw:=encode(extensions.gen_random_bytes(32),'hex');
  update public.checkin_qr_tokens set revoked_at=clock_timestamp() where organization_id=p_organization_id and tryout_id=p_tryout_id and registration_id=p_registration_id and used_at is null and revoked_at is null;
  insert into public.checkin_qr_tokens(organization_id,tryout_id,registration_id,token_digest,expires_at)
  values(p_organization_id,p_tryout_id,p_registration_id,encode(extensions.digest(raw,'sha256'),'hex'),clock_timestamp()+interval '24 hours');
  insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,details)
  values(p_organization_id,auth.uid(),'checkin.qr_issued','tryout_registration',p_registration_id,jsonb_build_object('expiresInHours',24));
  return raw;
end; $$;

revoke all on function public.sync_session_group_division(),public.audit_checkin_number_release(uuid,timestamptz,text,uuid) from public,anon,authenticated;
