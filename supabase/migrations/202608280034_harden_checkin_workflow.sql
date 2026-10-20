-- Harden the live check-in workflow without rewriting migration 033.  Authorization
-- placement and number scope are deliberately separate: a session/group operator is
-- authorized against the selected placement even when numbers are division scoped.

alter table public.checkins
  add column request_payload_digest text,
  add column initial_outcome text not null default 'checked_in';
update public.checkins set request_payload_digest=idempotency_key_digest where request_payload_digest is null;
alter table public.checkins
  alter column request_payload_digest set not null,
  add constraint checkins_payload_digest_check check(request_payload_digest ~ '^[0-9a-f]{64}$'),
  add constraint checkins_initial_outcome_check check(initial_outcome in ('checked_in'));

alter table public.tryout_numbers
  add constraint tryout_numbers_registration_identity_key unique(organization_id,tryout_id,registration_id,id);
alter table public.checkins
  add constraint checkins_number_registration_fkey
  foreign key(organization_id,tryout_id,registration_id,tryout_number_id)
  references public.tryout_numbers(organization_id,tryout_id,registration_id,id) on delete restrict;

drop index public.tryout_numbers_one_active_registration_scope_key;
create unique index tryout_numbers_one_active_tryout_registration_key
  on public.tryout_numbers(organization_id,tryout_id,registration_id)
  where released_at is null and scope_kind='tryout';
create unique index tryout_numbers_one_active_division_registration_key
  on public.tryout_numbers(organization_id,tryout_id,registration_id,division_id)
  where released_at is null and scope_kind='division';
create unique index tryout_numbers_one_active_session_registration_key
  on public.tryout_numbers(organization_id,tryout_id,registration_id,session_id)
  where released_at is null and scope_kind='session';
create unique index tryout_numbers_one_active_group_registration_key
  on public.tryout_numbers(organization_id,tryout_id,registration_id,session_id,group_id)
  where released_at is null and scope_kind='group';

alter table public.checkin_search_rate_counters add column rate_key_hash text;
update public.checkin_search_rate_counters
set rate_key_hash=encode(extensions.digest(actor_user_id::text||':'||tryout_id::text,'sha256'),'hex')
where rate_key_hash is null;
alter table public.checkin_search_rate_counters
  alter column rate_key_hash set not null,
  add constraint checkin_search_rate_key_check check(rate_key_hash ~ '^[0-9a-f]{64}$');
alter table public.checkin_search_rate_counters drop constraint checkin_search_rate_counters_pkey;
alter table public.checkin_search_rate_counters
  add primary key(actor_user_id,organization_id,tryout_id,rate_key_hash);
alter table public.checkin_search_rate_counters drop constraint checkin_search_attempts_check;
alter table public.checkin_search_rate_counters
  add constraint checkin_search_attempts_check check(attempts between 1 and 61);

create function public.checkin_assign_number_internal(
  p_organization_id uuid,p_tryout_id uuid,p_registration_id uuid,p_division_id uuid,
  p_authorization_session_id uuid,p_authorization_group_id uuid,
  p_number_session_id uuid,p_number_group_id uuid,p_scope_kind text,p_requested integer
) returns table(outcome text,assignment_id uuid,assigned_number integer,next_available integer)
language plpgsql security definer set search_path='' as $$
declare
  selected integer;
  existing public.tryout_numbers%rowtype;
  lock_scope text;
begin
  if p_scope_kind not in('tryout','division','session','group')
    or (p_requested is not null and p_requested not between 1 and 9999)
  then return query select 'invalid_request',null::uuid,null::integer,null::integer; return; end if;
  if not public.can_operate_checkin(p_organization_id,p_tryout_id,p_division_id,p_authorization_session_id,p_authorization_group_id)
  then return query select 'forbidden',null::uuid,null::integer,null::integer; return; end if;
  if (p_scope_kind in('tryout','division') and (p_number_session_id is not null or p_number_group_id is not null))
    or (p_scope_kind='session' and (p_number_session_id is null or p_number_group_id is not null))
    or (p_scope_kind='group' and (p_number_session_id is null or p_number_group_id is null))
  then return query select 'invalid_placement',null::uuid,null::integer,null::integer; return; end if;

  lock_scope:=concat_ws(':','checkin-number',p_organization_id,p_tryout_id,p_scope_kind,
    case when p_scope_kind<>'tryout' then p_division_id end,
    case when p_scope_kind in('session','group') then p_number_session_id end,
    case when p_scope_kind='group' then p_number_group_id end);
  perform pg_advisory_xact_lock(hashtextextended(lock_scope,0));

  select * into existing from public.tryout_numbers n
  where n.organization_id=p_organization_id and n.tryout_id=p_tryout_id
    and n.registration_id=p_registration_id and n.scope_kind=p_scope_kind and n.released_at is null
    and (p_scope_kind='tryout' or n.division_id=p_division_id)
    and (p_scope_kind not in('session','group') or n.session_id=p_number_session_id)
    and (p_scope_kind<>'group' or n.group_id=p_number_group_id)
  for update;

  select candidate into selected
  from generate_series(1,9999) candidate
  where not exists(
    select 1 from public.tryout_numbers n
    where n.organization_id=p_organization_id and n.tryout_id=p_tryout_id
      and n.scope_kind=p_scope_kind and n.number=candidate and n.released_at is null
      and (p_scope_kind='tryout' or n.division_id=p_division_id)
      and (p_scope_kind not in('session','group') or n.session_id=p_number_session_id)
      and (p_scope_kind<>'group' or n.group_id=p_number_group_id)
  ) order by candidate limit 1;

  if existing.id is not null and (p_requested is null or p_requested=existing.number)
  then return query select 'replayed',existing.id,existing.number,selected; return; end if;
  if p_requested is not null and exists(
    select 1 from public.tryout_numbers n
    where n.organization_id=p_organization_id and n.tryout_id=p_tryout_id
      and n.scope_kind=p_scope_kind and n.number=p_requested and n.released_at is null
      and n.id is distinct from existing.id
      and (p_scope_kind='tryout' or n.division_id=p_division_id)
      and (p_scope_kind not in('session','group') or n.session_id=p_number_session_id)
      and (p_scope_kind<>'group' or n.group_id=p_number_group_id)
  ) then return query select 'number_conflict',null::uuid,null::integer,selected; return; end if;
  selected:=coalesce(p_requested,selected);
  if selected is null then return query select 'exhausted',null::uuid,null::integer,null::integer; return; end if;

  if existing.id is not null then
    update public.tryout_numbers set number=selected,assigned_by_user_id=auth.uid(),assigned_at=clock_timestamp()
    where id=existing.id;
    insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id)
      values(p_organization_id,auth.uid(),'checkin.number_corrected','tryout_number',existing.id);
    return query select 'corrected',existing.id,selected,null::integer; return;
  end if;
  insert into public.tryout_numbers(organization_id,tryout_id,registration_id,division_id,session_id,group_id,scope_kind,number,assigned_by_user_id)
    values(p_organization_id,p_tryout_id,p_registration_id,p_division_id,p_number_session_id,p_number_group_id,p_scope_kind,selected,auth.uid())
    returning id into assignment_id;
  insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id)
    values(p_organization_id,auth.uid(),'checkin.number_assigned','tryout_registration',p_registration_id);
  return query select 'assigned',assignment_id,selected,null::integer;
end; $$;

create or replace function public.assign_tryout_number(
  p_organization_id uuid,p_tryout_id uuid,p_registration_id uuid,p_division_id uuid,
  p_session_id uuid,p_group_id uuid,p_scope_kind text,p_requested integer
) returns table(outcome text,assignment_id uuid,assigned_number integer,next_available integer)
language plpgsql security definer set search_path='' as $$
declare r public.tryout_registrations%rowtype;
begin
  if not public.can_operate_checkin(p_organization_id,p_tryout_id,p_division_id,p_session_id,p_group_id)
  then return query select 'forbidden',null::uuid,null::integer,null::integer; return; end if;
  if not exists(select 1 from public.tryouts t where t.organization_id=p_organization_id and t.id=p_tryout_id and t.status in('published','finalized'))
  then return query select 'invalid_placement',null::uuid,null::integer,null::integer; return; end if;
  select * into r from public.tryout_registrations
    where organization_id=p_organization_id and tryout_id=p_tryout_id and id=p_registration_id for update;
  if not found or r.division_id<>p_division_id then return query select 'invalid_registration',null::uuid,null::integer,null::integer; return; end if;
  if r.status='withdrawn' then return query select 'withdrawn',null::uuid,null::integer,null::integer; return; end if;
  if r.status='cancelled' then return query select 'cancelled',null::uuid,null::integer,null::integer; return; end if;
  return query select * from public.checkin_assign_number_internal(
    p_organization_id,p_tryout_id,p_registration_id,p_division_id,p_session_id,p_group_id,
    case when p_scope_kind in('session','group') then p_session_id end,
    case when p_scope_kind='group' then p_group_id end,p_scope_kind,p_requested);
end; $$;

create function public.release_tryout_number(
  p_organization_id uuid,p_tryout_id uuid,p_registration_id uuid,
  p_session_id uuid,p_group_id uuid,p_reason text
) returns text language plpgsql security definer set search_path='' as $$
declare division uuid; released_count integer;
begin
  select s.division_id into division from public.tryout_sessions s
    where s.organization_id=p_organization_id and s.tryout_id=p_tryout_id and s.id=p_session_id;
  if division is null or not public.can_operate_checkin(p_organization_id,p_tryout_id,division,p_session_id,p_group_id)
  then return 'forbidden'; end if;
  if p_reason not in('correction','withdrawal','cancellation','placement_changed','offboarding') then return 'invalid_request'; end if;
  update public.tryout_numbers n set released_at=clock_timestamp()
  where n.organization_id=p_organization_id and n.tryout_id=p_tryout_id and n.registration_id=p_registration_id and n.released_at is null;
  get diagnostics released_count=row_count;
  if released_count=0 then return 'not_found'; end if;
  insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id)
    values(p_organization_id,auth.uid(),'checkin.number_released','tryout_registration',p_registration_id);
  return 'released';
end; $$;

create function public.release_registration_numbers_trigger() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.status in('withdrawn','cancelled') and old.status is distinct from new.status then
    update public.tryout_numbers set released_at=clock_timestamp()
    where organization_id=new.organization_id and tryout_id=new.tryout_id and registration_id=new.id and released_at is null;
  end if;
  return new;
end; $$;
create trigger release_registration_numbers after update of status on public.tryout_registrations
for each row execute function public.release_registration_numbers_trigger();

create function public.release_stale_placement_numbers_trigger() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if tg_op='DELETE' then
    update public.tryout_numbers set released_at=clock_timestamp()
    where organization_id=old.organization_id and tryout_id=old.tryout_id and registration_id=old.registration_id
      and released_at is null and (
        (scope_kind='session' and session_id=old.session_id)
        or (scope_kind='group' and session_id=old.session_id and group_id is not distinct from old.group_id)
      );
    return old;
  elsif old.session_id is distinct from new.session_id or old.group_id is distinct from new.group_id then
    update public.tryout_numbers set released_at=clock_timestamp()
    where organization_id=new.organization_id and tryout_id=new.tryout_id and registration_id=new.registration_id
      and released_at is null and (
        (scope_kind='session' and old.session_id is distinct from new.session_id and session_id=old.session_id)
        or (scope_kind='group' and session_id=old.session_id and group_id is not distinct from old.group_id)
      );
  end if;
  return new;
end; $$;
create trigger release_stale_placement_numbers after update of session_id,group_id on public.session_enrollments
for each row execute function public.release_stale_placement_numbers_trigger();
create trigger release_removed_placement_numbers after delete on public.session_enrollments
for each row execute function public.release_stale_placement_numbers_trigger();

create function public.check_in_registration_v2(
  p_organization_id uuid,p_tryout_id uuid,p_registration_id uuid,p_session_id uuid,
  p_group_id uuid,p_idempotency_key text,p_scope_kind text,p_requested integer
) returns table(outcome text,receipt_id uuid,checked_in_at timestamptz,assigned_number integer,next_available integer)
language plpgsql security definer set search_path='' as $$
declare
  r public.tryout_registrations%rowtype; existing public.checkins%rowtype; active_receipt public.checkins%rowtype;
  session_row public.tryout_sessions%rowtype; group_row public.session_groups%rowtype;
  number_result record; key_digest text; payload_digest text; receipt uuid; receipt_time timestamptz;
  existing_enrollment public.session_enrollments%rowtype;
begin
  if p_idempotency_key !~ '^[A-Za-z0-9_-]{24,200}$' or p_scope_kind not in('tryout','division','session','group')
    or (p_requested is not null and p_requested not between 1 and 9999)
  then return query select 'invalid_request',null::uuid,null::timestamptz,null::integer,null::integer; return; end if;
  select * into session_row from public.tryout_sessions s
    where s.organization_id=p_organization_id and s.tryout_id=p_tryout_id and s.id=p_session_id;
  if session_row.id is null or not public.can_operate_checkin(p_organization_id,p_tryout_id,session_row.division_id,p_session_id,p_group_id)
  then return query select 'forbidden',null::uuid,null::timestamptz,null::integer,null::integer; return; end if;
  if not exists(select 1 from public.tryouts t where t.organization_id=p_organization_id and t.id=p_tryout_id and t.status in('published','finalized'))
  then return query select 'invalid_placement',null::uuid,null::timestamptz,null::integer,null::integer; return; end if;
  if p_group_id is not null and not exists(select 1 from public.session_groups g where g.organization_id=p_organization_id and g.tryout_id=p_tryout_id and g.session_id=p_session_id and g.id=p_group_id)
  then return query select 'invalid_placement',null::uuid,null::timestamptz,null::integer,null::integer; return; end if;

  key_digest:=encode(extensions.digest(p_idempotency_key,'sha256'),'hex');
  payload_digest:=encode(extensions.digest(concat_ws(':',p_organization_id,p_tryout_id,p_registration_id,p_session_id,coalesce(p_group_id::text,'-'),p_scope_kind,coalesce(p_requested::text,'auto')),'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtextextended('checkin-key:'||p_organization_id||':'||p_tryout_id||':'||key_digest,0));
  select * into existing from public.checkins c where c.organization_id=p_organization_id and c.tryout_id=p_tryout_id and c.idempotency_key_digest=key_digest;
  if existing.id is not null then
    if existing.request_payload_digest<>payload_digest then return query select 'conflict',null::uuid,null::timestamptz,null::integer,null::integer; return; end if;
    return query select existing.initial_outcome,existing.id,existing.checked_in_at,(select n.number from public.tryout_numbers n where n.id=existing.tryout_number_id),null::integer; return;
  end if;

  select * into r from public.tryout_registrations
    where organization_id=p_organization_id and tryout_id=p_tryout_id and id=p_registration_id for update;
  if not found or r.division_id<>session_row.division_id then return query select 'invalid_registration',null::uuid,null::timestamptz,null::integer,null::integer; return; end if;
  if r.status='withdrawn' then return query select 'withdrawn',null::uuid,null::timestamptz,null::integer,null::integer; return; end if;
  if r.status='cancelled' then return query select 'cancelled',null::uuid,null::timestamptz,null::integer,null::integer; return; end if;
  if public.registration_has_missing_information(r.id) then return query select 'missing_information',null::uuid,null::timestamptz,null::integer,null::integer; return; end if;
  select * into active_receipt from public.checkins c where c.organization_id=p_organization_id and c.tryout_id=p_tryout_id and c.registration_id=p_registration_id and c.session_id=p_session_id and c.reversed_at is null;
  if active_receipt.id is not null then return query select 'already_checked_in',active_receipt.id,active_receipt.checked_in_at,(select n.number from public.tryout_numbers n where n.id=active_receipt.tryout_number_id),null::integer; return; end if;

  -- Capacity is decided before allocating a number so a losing last-slot caller
  -- does not retain a number from a failed check-in.
  select * into session_row from public.tryout_sessions s where s.organization_id=p_organization_id and s.tryout_id=p_tryout_id and s.id=p_session_id for update;
  if p_group_id is not null then select * into group_row from public.session_groups g where g.organization_id=p_organization_id and g.tryout_id=p_tryout_id and g.session_id=p_session_id and g.id=p_group_id for update; end if;
  select * into existing_enrollment from public.session_enrollments e where e.organization_id=p_organization_id and e.registration_id=p_registration_id and e.session_id=p_session_id for update;
  if existing_enrollment.id is null and session_row.capacity is not null and
    (select count(*) from public.session_enrollments e where e.organization_id=p_organization_id and e.tryout_id=p_tryout_id and e.session_id=p_session_id)>=session_row.capacity
  then return query select 'capacity',null::uuid,null::timestamptz,null::integer,null::integer; return; end if;
  if p_group_id is not null and existing_enrollment.group_id is distinct from p_group_id and group_row.capacity is not null and
    (select count(*) from public.session_enrollments e where e.organization_id=p_organization_id and e.tryout_id=p_tryout_id and e.session_id=p_session_id and e.group_id=p_group_id)>=group_row.capacity
  then return query select 'capacity',null::uuid,null::timestamptz,null::integer,null::integer; return; end if;

  select * into number_result from public.checkin_assign_number_internal(
    p_organization_id,p_tryout_id,p_registration_id,r.division_id,p_session_id,p_group_id,
    case when p_scope_kind in('session','group') then p_session_id end,
    case when p_scope_kind='group' then p_group_id end,p_scope_kind,p_requested);
  if number_result.outcome not in('assigned','replayed','corrected') then
    return query select number_result.outcome,null::uuid,null::timestamptz,null::integer,number_result.next_available; return;
  end if;

  insert into public.session_enrollments(organization_id,tryout_id,registration_id,session_id,group_id)
    values(p_organization_id,p_tryout_id,p_registration_id,p_session_id,p_group_id)
    on conflict(organization_id,registration_id,session_id) do update set group_id=excluded.group_id,updated_at=clock_timestamp();
  insert into public.checkins(organization_id,tryout_id,registration_id,session_id,group_id,tryout_number_id,idempotency_key_digest,request_payload_digest,checked_in_by_user_id)
    values(p_organization_id,p_tryout_id,p_registration_id,p_session_id,p_group_id,number_result.assignment_id,key_digest,payload_digest,auth.uid())
    returning id,checkins.checked_in_at into receipt,receipt_time;
  update public.checkin_qr_tokens set used_at=clock_timestamp() where organization_id=p_organization_id and tryout_id=p_tryout_id and registration_id=p_registration_id and used_at is null and revoked_at is null;
  insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id)
    values(p_organization_id,auth.uid(),'checkin.completed','checkin',receipt);
  return query select 'checked_in',receipt,receipt_time,number_result.assigned_number,null::integer;
end; $$;

create function public.search_checkin_registrations_v2(
  p_organization_id uuid,p_tryout_id uuid,p_session_id uuid,p_group_id uuid,
  p_query text,p_limit integer,p_rate_key_hash text
) returns table(outcome text,registration_id uuid,athlete_name text,guardian_name text,division_name text,tryout_number integer,checkin_status text)
language plpgsql security definer set search_path='' as $$
declare q text; attempts_after integer; division uuid;
begin
  q:=public.canonical_import_text(trim(p_query));
  if auth.uid() is null or char_length(q) not between 2 and 120 or p_limit not between 1 and 25
    or p_rate_key_hash<>encode(extensions.digest(auth.uid()::text||':'||p_organization_id::text||':'||p_tryout_id::text||':checkin-search','sha256'),'hex')
  then return query select 'invalid_request',null::uuid,null::text,null::text,null::text,null::integer,null::text; return; end if;
  select s.division_id into division from public.tryout_sessions s where s.organization_id=p_organization_id and s.tryout_id=p_tryout_id and s.id=p_session_id;
  if division is null or not public.can_operate_checkin(p_organization_id,p_tryout_id,division,p_session_id,p_group_id)
  then return query select 'forbidden',null::uuid,null::text,null::text,null::text,null::integer,null::text; return; end if;
  insert into public.checkin_search_rate_counters(actor_user_id,organization_id,tryout_id,rate_key_hash,attempts,window_started_at,expires_at)
    values(auth.uid(),p_organization_id,p_tryout_id,p_rate_key_hash,1,clock_timestamp(),clock_timestamp()+interval '1 minute')
    on conflict(actor_user_id,organization_id,tryout_id,rate_key_hash) do update set
      attempts=case when public.checkin_search_rate_counters.expires_at<=clock_timestamp() then 1 else least(61,public.checkin_search_rate_counters.attempts+1) end,
      window_started_at=case when public.checkin_search_rate_counters.expires_at<=clock_timestamp() then clock_timestamp() else public.checkin_search_rate_counters.window_started_at end,
      expires_at=case when public.checkin_search_rate_counters.expires_at<=clock_timestamp() then clock_timestamp()+interval '1 minute' else public.checkin_search_rate_counters.expires_at end
    returning attempts into attempts_after;
  if attempts_after>60 then return query select 'rate_limited',null::uuid,null::text,null::text,null::text,null::integer,null::text; return; end if;
  return query
  select 'ok',r.id,a.given_name||' '||a.family_name,coalesce(g.name,''),d.name,
    (select tn.number from public.tryout_numbers tn where tn.organization_id=r.organization_id and tn.tryout_id=r.tryout_id and tn.registration_id=r.id and tn.released_at is null order by tn.assigned_at desc,tn.id limit 1),
    case when r.status='withdrawn' then 'withdrawn' when r.status='cancelled' then 'cancelled'
      when public.registration_has_missing_information(r.id) then 'missing_information'
      when exists(select 1 from public.checkins c where c.organization_id=r.organization_id and c.tryout_id=r.tryout_id and c.registration_id=r.id and c.session_id=p_session_id and c.reversed_at is null) then 'checked_in' else 'ready' end
  from public.tryout_registrations r
  join public.athletes a on a.organization_id=r.organization_id and a.id=r.athlete_id
  join public.tryout_divisions d on d.organization_id=r.organization_id and d.tryout_id=r.tryout_id and d.id=r.division_id
  left join public.athlete_guardians ag on ag.organization_id=a.organization_id and ag.athlete_id=a.id and ag.is_primary_contact
  left join public.guardians g on g.organization_id=ag.organization_id and g.id=ag.guardian_id
  where r.organization_id=p_organization_id and r.tryout_id=p_tryout_id and r.division_id=division
    and (not exists(select 1 from public.session_enrollments e where e.organization_id=r.organization_id and e.tryout_id=r.tryout_id and e.registration_id=r.id)
      or exists(select 1 from public.session_enrollments e where e.organization_id=r.organization_id and e.tryout_id=r.tryout_id and e.registration_id=r.id and e.session_id=p_session_id and (p_group_id is null or e.group_id=p_group_id)))
    and (
      strpos(public.canonical_import_text(a.given_name||' '||a.family_name),q)>0
      or strpos(public.canonical_import_text(coalesce(g.name,'')),q)>0
      or r.id::text=trim(p_query)
      or (trim(p_query)~'^[0-9]{1,4}$' and exists(select 1 from public.tryout_numbers tn where tn.organization_id=r.organization_id and tn.tryout_id=r.tryout_id and tn.registration_id=r.id and tn.released_at is null and tn.number=trim(p_query)::integer))
      or (ag.communication_permitted and char_length(regexp_replace(p_query,'[^0-9]','','g'))>=7 and strpos(regexp_replace(coalesce(g.phone,''),'[^0-9]','','g'),regexp_replace(p_query,'[^0-9]','','g'))>0)
      or (trim(p_query)~'^[0-9a-f]{64}$' and exists(select 1 from public.checkin_qr_tokens t where t.organization_id=r.organization_id and t.tryout_id=r.tryout_id and t.registration_id=r.id and t.token_digest=encode(extensions.digest(trim(p_query),'sha256'),'hex') and t.used_at is null and t.revoked_at is null and t.expires_at>clock_timestamp()))
    )
  order by a.family_name,a.given_name,r.id limit p_limit;
end; $$;

create or replace function public.check_in_registration(
  p_organization_id uuid,p_tryout_id uuid,p_registration_id uuid,p_session_id uuid,
  p_group_id uuid,p_idempotency_key text,p_scope_kind text,p_requested integer
) returns table(outcome text,receipt_id uuid,checked_in_at timestamptz,assigned_number integer,next_available integer)
language sql security definer set search_path='' as $$
  select * from public.check_in_registration_v2(
    p_organization_id,p_tryout_id,p_registration_id,p_session_id,p_group_id,
    p_idempotency_key,p_scope_kind,p_requested
  );
$$;

-- Compatibility projection for callers deployed with migration 033. New callers
-- must use v2 so their selected authorization placement is explicit.
create or replace function public.search_checkin_registrations(
  p_organization_id uuid,p_tryout_id uuid,p_query text,p_limit integer,p_rate_key_hash text
) returns table(registration_id uuid,athlete_name text,guardian_name text,division_name text,tryout_number integer,checkin_status text)
language plpgsql security definer set search_path='' as $$
declare selected_session uuid; selected_group uuid;
begin
  select s.id,g.id into selected_session,selected_group
  from public.tryout_sessions s
  cross join lateral (
    select null::uuid as id,-1 as sort_order
    union all
    select sg.id,sg.sort_order from public.session_groups sg
    where sg.organization_id=s.organization_id and sg.tryout_id=s.tryout_id and sg.session_id=s.id
  ) g
  where s.organization_id=p_organization_id and s.tryout_id=p_tryout_id
    and public.can_operate_checkin(p_organization_id,p_tryout_id,s.division_id,s.id,g.id)
  order by s.starts_at,g.sort_order nulls first limit 1;
  if selected_session is null then return; end if;
  return query select v.registration_id,v.athlete_name,v.guardian_name,v.division_name,v.tryout_number,v.checkin_status
  from public.search_checkin_registrations_v2(
    p_organization_id,p_tryout_id,selected_session,selected_group,p_query,p_limit,
    encode(extensions.digest(auth.uid()::text||':'||p_organization_id::text||':'||p_tryout_id::text||':checkin-search','sha256'),'hex')
  ) v
  where v.outcome='ok';
end; $$;

create or replace function public.issue_checkin_qr_token(p_organization_id uuid,p_tryout_id uuid,p_registration_id uuid)
returns text language plpgsql security definer set search_path='' as $$
declare raw text;
begin
  if not public.is_active_organization_member(p_organization_id,array['owner','administrator'])
    or not exists(select 1 from public.tryouts t where t.organization_id=p_organization_id and t.id=p_tryout_id and t.status in('published','finalized'))
  then return null; end if;
  if not exists(select 1 from public.tryout_registrations r where r.organization_id=p_organization_id and r.tryout_id=p_tryout_id and r.id=p_registration_id and r.status='submitted') then return null; end if;
  raw:=encode(extensions.gen_random_bytes(32),'hex');
  update public.checkin_qr_tokens set revoked_at=clock_timestamp() where organization_id=p_organization_id and tryout_id=p_tryout_id and registration_id=p_registration_id and used_at is null and revoked_at is null;
  insert into public.checkin_qr_tokens(organization_id,tryout_id,registration_id,token_digest,expires_at)
    values(p_organization_id,p_tryout_id,p_registration_id,encode(extensions.digest(raw,'sha256'),'hex'),clock_timestamp()+interval '24 hours');
  insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id)
    values(p_organization_id,auth.uid(),'checkin.qr_issued','tryout_registration',p_registration_id);
  return raw;
end; $$;

revoke all on function public.checkin_assign_number_internal(uuid,uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,integer),
  public.release_registration_numbers_trigger(),public.release_stale_placement_numbers_trigger(),
  public.release_tryout_number(uuid,uuid,uuid,uuid,uuid,text),
  public.check_in_registration_v2(uuid,uuid,uuid,uuid,uuid,text,text,integer),
  public.search_checkin_registrations_v2(uuid,uuid,uuid,uuid,text,integer,text) from public,anon,authenticated;
grant execute on function public.release_tryout_number(uuid,uuid,uuid,uuid,uuid,text),
  public.check_in_registration_v2(uuid,uuid,uuid,uuid,uuid,text,text,integer),
  public.search_checkin_registrations_v2(uuid,uuid,uuid,uuid,text,integer,text) to authenticated;
