-- Check-in is exposed only through bounded security-definer commands. Operational
-- staff receive minimum search projections, never direct athlete/contact tables.

create table public.tryout_numbers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  tryout_id uuid not null,
  registration_id uuid not null,
  division_id uuid not null,
  session_id uuid,
  group_id uuid,
  scope_kind text not null,
  number integer not null,
  assigned_by_user_id uuid not null references auth.users(id) on delete restrict,
  assigned_at timestamptz not null default clock_timestamp(),
  released_at timestamptz,
  constraint tryout_numbers_organization_id_id_key unique(organization_id,id),
  constraint tryout_numbers_registration_fkey foreign key(organization_id,tryout_id,registration_id)
    references public.tryout_registrations(organization_id,tryout_id,id) on delete cascade,
  constraint tryout_numbers_division_fkey foreign key(organization_id,tryout_id,division_id)
    references public.tryout_divisions(organization_id,tryout_id,id) on delete restrict,
  constraint tryout_numbers_session_fkey foreign key(organization_id,tryout_id,session_id)
    references public.tryout_sessions(organization_id,tryout_id,id) on delete restrict,
  constraint tryout_numbers_group_fkey foreign key(organization_id,tryout_id,session_id,group_id)
    references public.session_groups(organization_id,tryout_id,session_id,id) on delete restrict,
  constraint tryout_numbers_scope_check check(
    (scope_kind='tryout' and session_id is null and group_id is null)
    or (scope_kind='division' and session_id is null and group_id is null)
    or (scope_kind='session' and session_id is not null and group_id is null)
    or (scope_kind='group' and session_id is not null and group_id is not null)
  ),
  constraint tryout_numbers_number_check check(number between 1 and 9999),
  constraint tryout_numbers_release_check check(released_at is null or released_at>=assigned_at)
);
create unique index tryout_numbers_one_active_registration_scope_key
  on public.tryout_numbers(organization_id,registration_id,scope_kind,division_id,session_id,group_id) nulls not distinct
  where released_at is null;
create unique index tryout_numbers_active_tryout_number_key
  on public.tryout_numbers(organization_id,tryout_id,number) where released_at is null and scope_kind='tryout';
create unique index tryout_numbers_active_division_number_key
  on public.tryout_numbers(organization_id,tryout_id,division_id,number) where released_at is null and scope_kind='division';
create unique index tryout_numbers_active_session_number_key
  on public.tryout_numbers(organization_id,tryout_id,session_id,number) where released_at is null and scope_kind='session';
create unique index tryout_numbers_active_group_number_key
  on public.tryout_numbers(organization_id,tryout_id,session_id,group_id,number) where released_at is null and scope_kind='group';

create table public.checkins (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  tryout_id uuid not null,
  registration_id uuid not null,
  session_id uuid not null,
  group_id uuid,
  tryout_number_id uuid not null,
  idempotency_key_digest text not null,
  checked_in_by_user_id uuid not null references auth.users(id) on delete restrict,
  checked_in_at timestamptz not null default clock_timestamp(),
  reversed_at timestamptz,
  constraint checkins_organization_id_id_key unique(organization_id,id),
  constraint checkins_registration_fkey foreign key(organization_id,tryout_id,registration_id)
    references public.tryout_registrations(organization_id,tryout_id,id) on delete cascade,
  constraint checkins_session_fkey foreign key(organization_id,tryout_id,session_id)
    references public.tryout_sessions(organization_id,tryout_id,id) on delete restrict,
  constraint checkins_group_fkey foreign key(organization_id,tryout_id,session_id,group_id)
    references public.session_groups(organization_id,tryout_id,session_id,id) on delete restrict,
  constraint checkins_number_fkey foreign key(organization_id,tryout_number_id)
    references public.tryout_numbers(organization_id,id) on delete restrict,
  constraint checkins_digest_check check(idempotency_key_digest ~ '^[0-9a-f]{64}$'),
  constraint checkins_reverse_check check(reversed_at is null or reversed_at>=checked_in_at)
);
create unique index checkins_one_active_registration_session_key
  on public.checkins(organization_id,tryout_id,registration_id,session_id) where reversed_at is null;
create unique index checkins_idempotency_key
  on public.checkins(organization_id,tryout_id,idempotency_key_digest);

create table public.checkin_qr_tokens (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  tryout_id uuid not null,
  registration_id uuid not null,
  token_digest text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  constraint checkin_qr_registration_fkey foreign key(organization_id,tryout_id,registration_id)
    references public.tryout_registrations(organization_id,tryout_id,id) on delete cascade,
  constraint checkin_qr_digest_check check(token_digest ~ '^[0-9a-f]{64}$'),
  constraint checkin_qr_expiry_check check(expires_at>created_at)
);
create index checkin_qr_active_lookup_idx on public.checkin_qr_tokens(token_digest,expires_at)
  where used_at is null and revoked_at is null;

create table public.checkin_search_rate_counters (
  actor_user_id uuid not null references auth.users(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  tryout_id uuid not null,
  attempts integer not null,
  window_started_at timestamptz not null,
  expires_at timestamptz not null,
  primary key(actor_user_id,organization_id,tryout_id),
  constraint checkin_search_rate_tryout_fkey foreign key(organization_id,tryout_id)
    references public.tryouts(organization_id,id) on delete cascade,
  constraint checkin_search_attempts_check check(attempts between 1 and 60),
  constraint checkin_search_expiry_check check(expires_at>window_started_at)
);

alter table public.tryout_numbers enable row level security;
alter table public.checkins enable row level security;
alter table public.checkin_qr_tokens enable row level security;
alter table public.checkin_search_rate_counters enable row level security;

create function public.can_operate_checkin(
  p_organization_id uuid,p_tryout_id uuid,p_division_id uuid,p_session_id uuid,p_group_id uuid
) returns boolean language sql stable security definer set search_path='' as $$
  select public.is_active_organization_member(p_organization_id,array['owner','administrator'])
    or (
      public.is_active_organization_member(p_organization_id)
      and exists(
        select 1 from public.tryout_staff_assignments a
        where a.organization_id=p_organization_id and a.tryout_id=p_tryout_id
          and a.user_id=auth.uid() and a.role in('director','checkin')
          and a.revoked_at is null and (a.expires_at is null or a.expires_at>clock_timestamp())
          and (
            a.scope_kind='tryout'
            or (a.scope_kind='division' and a.division_id=p_division_id)
            or (a.scope_kind='session' and a.session_id=p_session_id)
            or (a.scope_kind='group' and a.session_id=p_session_id and a.group_id=p_group_id)
          )
      )
    );
$$;

create function public.registration_has_missing_information(p_registration_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(
    select 1
    from public.tryout_registrations r
    join public.registration_form_versions v
      on v.organization_id=r.organization_id and v.tryout_id=r.tryout_id and v.id=r.registration_form_version_id
    cross join lateral jsonb_array_elements(v.schema->'fields') f
    where r.id=p_registration_id and (f->>'required')::boolean
      and (
        not (r.responses ? (f->>'key'))
        or r.responses->(f->>'key') in ('null'::jsonb,'""'::jsonb)
        or (f->>'kind'='consent' and r.responses->(f->>'key')<>'true'::jsonb)
      )
  );
$$;

create function public.assign_tryout_number(
  p_organization_id uuid,p_tryout_id uuid,p_registration_id uuid,p_division_id uuid,
  p_session_id uuid,p_group_id uuid,p_scope_kind text,p_requested integer
) returns table(outcome text,assignment_id uuid,assigned_number integer,next_available integer)
language plpgsql security definer set search_path='' as $$
declare r public.tryout_registrations%rowtype; selected integer; existing public.tryout_numbers%rowtype;
begin
  if p_scope_kind not in('tryout','division','session','group') or p_requested is not null and p_requested not between 1 and 9999 then
    return query select 'invalid_placement',null::uuid,null::integer,null::integer; return;
  end if;
  if not exists(select 1 from public.tryouts t where t.organization_id=p_organization_id and t.id=p_tryout_id and t.status in('published','finalized')) then
    return query select 'invalid_registration',null::uuid,null::integer,null::integer; return;
  end if;
  select * into r from public.tryout_registrations where organization_id=p_organization_id and tryout_id=p_tryout_id and id=p_registration_id for update;
  if not found or r.division_id<>p_division_id then return query select 'invalid_registration',null::uuid,null::integer,null::integer; return; end if;
  if r.status='withdrawn' then return query select 'withdrawn',null::uuid,null::integer,null::integer; return; end if;
  if r.status<>'submitted' then return query select 'invalid_registration',null::uuid,null::integer,null::integer; return; end if;
  if p_session_id is not null and not exists(select 1 from public.tryout_sessions s where s.organization_id=p_organization_id and s.tryout_id=p_tryout_id and s.id=p_session_id and s.division_id=p_division_id)
    or p_group_id is not null and not exists(select 1 from public.session_groups g where g.organization_id=p_organization_id and g.tryout_id=p_tryout_id and g.session_id=p_session_id and g.id=p_group_id)
    or p_scope_kind in('session','group') and p_session_id is null
    or p_scope_kind='group' and p_group_id is null
    or p_scope_kind in('tryout','division') and (p_session_id is not null or p_group_id is not null)
  then return query select 'invalid_placement',null::uuid,null::integer,null::integer; return; end if;
  if not public.can_operate_checkin(p_organization_id,p_tryout_id,p_division_id,p_session_id,p_group_id) then
    return query select 'forbidden',null::uuid,null::integer,null::integer; return;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(concat_ws(':','number',p_organization_id,p_tryout_id,p_scope_kind,p_division_id,p_session_id,p_group_id),0));
  select * into existing from public.tryout_numbers n where n.organization_id=p_organization_id and n.registration_id=p_registration_id
    and n.scope_kind=p_scope_kind and n.division_id=p_division_id and n.session_id is not distinct from p_session_id
    and n.group_id is not distinct from p_group_id and n.released_at is null;
  if found then return query select 'replayed',existing.id,existing.number,null::integer; return; end if;
  select candidate into selected from generate_series(1,9999) candidate where not exists(
    select 1 from public.tryout_numbers n where n.organization_id=p_organization_id and n.tryout_id=p_tryout_id and n.number=candidate and n.released_at is null
      and n.scope_kind=p_scope_kind
      and (p_scope_kind='tryout' or n.division_id=p_division_id)
      and (p_scope_kind not in('session','group') or n.session_id=p_session_id)
      and (p_scope_kind<>'group' or n.group_id=p_group_id)
  ) order by candidate limit 1;
  if p_requested is not null and exists(
    select 1 from public.tryout_numbers n where n.organization_id=p_organization_id and n.tryout_id=p_tryout_id and n.number=p_requested and n.released_at is null
      and n.scope_kind=p_scope_kind and (p_scope_kind='tryout' or n.division_id=p_division_id)
      and (p_scope_kind not in('session','group') or n.session_id=p_session_id) and (p_scope_kind<>'group' or n.group_id=p_group_id)
  ) then return query select 'number_conflict',null::uuid,null::integer,selected; return; end if;
  selected:=coalesce(p_requested,selected);
  if selected is null then return query select 'number_conflict',null::uuid,null::integer,null::integer; return; end if;
  insert into public.tryout_numbers(organization_id,tryout_id,registration_id,division_id,session_id,group_id,scope_kind,number,assigned_by_user_id)
    values(p_organization_id,p_tryout_id,p_registration_id,p_division_id,p_session_id,p_group_id,p_scope_kind,selected,auth.uid())
    returning id into assignment_id;
  insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id)
    values(p_organization_id,auth.uid(),'checkin.number_assigned','tryout_registration',p_registration_id);
  return query select 'assigned',assignment_id,selected,null::integer;
exception when unique_violation then
  return query select 'number_conflict',null::uuid,null::integer,
    (select candidate from generate_series(1,9999) candidate where not exists(select 1 from public.tryout_numbers n where n.organization_id=p_organization_id and n.tryout_id=p_tryout_id and n.scope_kind=p_scope_kind and n.number=candidate and n.released_at is null) order by candidate limit 1);
end; $$;

create function public.check_in_registration(
  p_organization_id uuid,p_tryout_id uuid,p_registration_id uuid,p_session_id uuid,
  p_group_id uuid,p_idempotency_key text,p_scope_kind text,p_requested integer
) returns table(outcome text,receipt_id uuid,checked_in_at timestamptz,assigned_number integer,next_available integer)
language plpgsql security definer set search_path='' as $$
declare r public.tryout_registrations%rowtype; existing public.checkins%rowtype; enrollment_id uuid; number_result record; digest text; receipt uuid; receipt_time timestamptz;
begin
  if p_idempotency_key !~ '^[A-Za-z0-9_-]{24,200}$' then return query select 'invalid_request',null::uuid,null::timestamptz,null::integer,null::integer; return; end if;
  digest:=encode(extensions.digest(p_idempotency_key,'sha256'),'hex');
  select * into r from public.tryout_registrations where organization_id=p_organization_id and tryout_id=p_tryout_id and id=p_registration_id for update;
  if not found then return query select 'invalid_registration',null::uuid,null::timestamptz,null::integer,null::integer; return; end if;
  if r.status='withdrawn' then return query select 'withdrawn',null::uuid,null::timestamptz,null::integer,null::integer; return; end if;
  if r.status='cancelled' then return query select 'cancelled',null::uuid,null::timestamptz,null::integer,null::integer; return; end if;
  if public.registration_has_missing_information(r.id) then return query select 'missing_information',null::uuid,null::timestamptz,null::integer,null::integer; return; end if;
  if not exists(select 1 from public.tryout_sessions s where s.organization_id=p_organization_id and s.tryout_id=p_tryout_id and s.id=p_session_id and s.division_id=r.division_id)
    or p_group_id is not null and not exists(select 1 from public.session_groups g where g.organization_id=p_organization_id and g.tryout_id=p_tryout_id and g.session_id=p_session_id and g.id=p_group_id)
  then return query select 'invalid_placement',null::uuid,null::timestamptz,null::integer,null::integer; return; end if;
  if not public.can_operate_checkin(p_organization_id,p_tryout_id,r.division_id,p_session_id,p_group_id) then
    return query select 'forbidden',null::uuid,null::timestamptz,null::integer,null::integer; return;
  end if;
  select * into existing from public.checkins c where c.organization_id=p_organization_id and c.tryout_id=p_tryout_id and c.registration_id=p_registration_id and c.session_id=p_session_id and c.reversed_at is null;
  if found then return query select 'already_checked_in',existing.id,existing.checked_in_at,(select n.number from public.tryout_numbers n where n.id=existing.tryout_number_id),null::integer; return; end if;
  select * into number_result from public.assign_tryout_number(p_organization_id,p_tryout_id,p_registration_id,r.division_id,
    case when p_scope_kind in('session','group') then p_session_id end,case when p_scope_kind='group' then p_group_id end,p_scope_kind,p_requested);
  if number_result.outcome='number_conflict' then return query select 'number_conflict',null::uuid,null::timestamptz,null::integer,number_result.next_available; return; end if;
  if number_result.outcome not in('assigned','replayed') then return query select number_result.outcome,null::uuid,null::timestamptz,null::integer,number_result.next_available; return; end if;
  insert into public.session_enrollments(organization_id,tryout_id,registration_id,session_id,group_id)
    values(p_organization_id,p_tryout_id,p_registration_id,p_session_id,p_group_id)
    on conflict(organization_id,registration_id,session_id) do update set group_id=excluded.group_id,updated_at=clock_timestamp()
    returning id into enrollment_id;
  insert into public.checkins(organization_id,tryout_id,registration_id,session_id,group_id,tryout_number_id,idempotency_key_digest,checked_in_by_user_id)
    values(p_organization_id,p_tryout_id,p_registration_id,p_session_id,p_group_id,number_result.assignment_id,digest,auth.uid())
    returning id,checkins.checked_in_at into receipt,receipt_time;
  update public.checkin_qr_tokens set used_at=clock_timestamp() where organization_id=p_organization_id and tryout_id=p_tryout_id and registration_id=p_registration_id and used_at is null and revoked_at is null;
  insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id)
    values(p_organization_id,auth.uid(),'checkin.completed','checkin',receipt);
  return query select 'checked_in',receipt,receipt_time,number_result.assigned_number,null::integer;
exception when unique_violation then
  select * into existing from public.checkins c where c.organization_id=p_organization_id and c.tryout_id=p_tryout_id and c.registration_id=p_registration_id and c.session_id=p_session_id and c.reversed_at is null;
  if found then return query select 'already_checked_in',existing.id,existing.checked_in_at,(select n.number from public.tryout_numbers n where n.id=existing.tryout_number_id),null::integer; else raise; end if;
end; $$;

create function public.search_checkin_registrations(
  p_organization_id uuid,p_tryout_id uuid,p_query text,p_limit integer,p_rate_key_hash text
) returns table(registration_id uuid,athlete_name text,guardian_name text,division_name text,tryout_number integer,checkin_status text)
language plpgsql security definer set search_path='' as $$
declare q text; attempts_after integer;
begin
  q:=trim(p_query);
  if auth.uid() is null or char_length(q) not between 2 and 120 or p_limit not between 1 and 25 or p_rate_key_hash !~ '^[0-9a-f]{64}$' then return; end if;
  if not public.is_active_organization_member(p_organization_id)
    or not (
      public.is_active_organization_member(p_organization_id,array['owner','administrator'])
      or exists(select 1 from public.tryout_staff_assignments a where a.organization_id=p_organization_id and a.tryout_id=p_tryout_id
        and a.user_id=auth.uid() and a.role in('director','checkin') and a.revoked_at is null
        and (a.expires_at is null or a.expires_at>clock_timestamp()))
    ) then return; end if;
  insert into public.checkin_search_rate_counters(actor_user_id,organization_id,tryout_id,attempts,window_started_at,expires_at)
    values(auth.uid(),p_organization_id,p_tryout_id,1,clock_timestamp(),clock_timestamp()+interval '1 minute')
    on conflict(actor_user_id,organization_id,tryout_id) do update set
      attempts=case when checkin_search_rate_counters.expires_at<=clock_timestamp() then 1 else least(60,checkin_search_rate_counters.attempts+1) end,
      window_started_at=case when checkin_search_rate_counters.expires_at<=clock_timestamp() then clock_timestamp() else checkin_search_rate_counters.window_started_at end,
      expires_at=case when checkin_search_rate_counters.expires_at<=clock_timestamp() then clock_timestamp()+interval '1 minute' else checkin_search_rate_counters.expires_at end
    returning attempts into attempts_after;
  if attempts_after>=60 then return; end if;
  return query
  select r.id,a.given_name||' '||a.family_name,coalesce(g.name,''),d.name,n.number,
    case when r.status='withdrawn' then 'withdrawn' when public.registration_has_missing_information(r.id) then 'missing_information'
      when exists(select 1 from public.checkins c where c.organization_id=r.organization_id and c.registration_id=r.id and c.reversed_at is null) then 'checked_in' else 'ready' end
  from public.tryout_registrations r
  join public.athletes a on a.organization_id=r.organization_id and a.id=r.athlete_id
  join public.tryout_divisions d on d.organization_id=r.organization_id and d.tryout_id=r.tryout_id and d.id=r.division_id
  left join lateral(
    select e.session_id,e.group_id from public.session_enrollments e
    where e.organization_id=r.organization_id and e.tryout_id=r.tryout_id and e.registration_id=r.id
      and public.can_operate_checkin(r.organization_id,r.tryout_id,r.division_id,e.session_id,e.group_id)
    order by e.session_id,e.group_id nulls first limit 1
  ) operational on true
  left join public.athlete_guardians ag on ag.organization_id=a.organization_id and ag.athlete_id=a.id and ag.is_primary_contact
  left join public.guardians g on g.organization_id=ag.organization_id and g.id=ag.guardian_id
  left join lateral(select tn.number from public.tryout_numbers tn where tn.organization_id=r.organization_id and tn.registration_id=r.id and tn.released_at is null order by tn.assigned_at desc limit 1)n on true
  where r.organization_id=p_organization_id and r.tryout_id=p_tryout_id
    and (
      public.canonical_import_text(a.given_name||' '||a.family_name) like '%'||public.canonical_import_text(q)||'%'
      or public.canonical_import_text(coalesce(g.name,'')) like '%'||public.canonical_import_text(q)||'%'
      or r.id::text=q or (q~'^[0-9]{1,4}$' and n.number=q::integer)
      or (ag.communication_permitted is true and regexp_replace(coalesce(g.phone,''),'[^0-9]','','g') like '%'||regexp_replace(q,'[^0-9]','','g')||'%' and char_length(regexp_replace(q,'[^0-9]','','g'))>=7)
      or (q~'^[0-9a-f]{64}$' and exists(select 1 from public.checkin_qr_tokens t where t.organization_id=r.organization_id and t.tryout_id=r.tryout_id and t.registration_id=r.id and t.token_digest=encode(extensions.digest(q,'sha256'),'hex') and t.used_at is null and t.revoked_at is null and t.expires_at>clock_timestamp()))
    )
    and (public.is_active_organization_member(r.organization_id,array['owner','administrator']) or operational.session_id is not null)
  order by a.family_name,a.given_name,r.id limit p_limit;
end; $$;

create function public.issue_checkin_qr_token(p_organization_id uuid,p_tryout_id uuid,p_registration_id uuid)
returns text language plpgsql security definer set search_path='' as $$
declare raw text; division uuid;
begin
  select division_id into division from public.tryout_registrations where organization_id=p_organization_id and tryout_id=p_tryout_id and id=p_registration_id;
  if not found or not public.is_active_organization_member(p_organization_id,array['owner','administrator']) then return null; end if;
  raw:=encode(extensions.gen_random_bytes(32),'hex');
  update public.checkin_qr_tokens set revoked_at=clock_timestamp() where organization_id=p_organization_id and tryout_id=p_tryout_id and registration_id=p_registration_id and used_at is null and revoked_at is null;
  insert into public.checkin_qr_tokens(organization_id,tryout_id,registration_id,token_digest,expires_at)
    values(p_organization_id,p_tryout_id,p_registration_id,encode(extensions.digest(raw,'sha256'),'hex'),clock_timestamp()+interval '24 hours');
  return raw;
end; $$;

revoke all on table public.tryout_numbers,public.checkins,public.checkin_qr_tokens,public.checkin_search_rate_counters from public,anon,authenticated;
revoke all on function public.can_operate_checkin(uuid,uuid,uuid,uuid,uuid),public.registration_has_missing_information(uuid),
  public.assign_tryout_number(uuid,uuid,uuid,uuid,uuid,uuid,text,integer),public.check_in_registration(uuid,uuid,uuid,uuid,uuid,text,text,integer),
  public.search_checkin_registrations(uuid,uuid,text,integer,text),public.issue_checkin_qr_token(uuid,uuid,uuid) from public,anon;
revoke execute on function public.can_operate_checkin(uuid,uuid,uuid,uuid,uuid),public.registration_has_missing_information(uuid) from authenticated;
grant execute on function public.assign_tryout_number(uuid,uuid,uuid,uuid,uuid,uuid,text,integer),public.check_in_registration(uuid,uuid,uuid,uuid,uuid,text,text,integer),
  public.search_checkin_registrations(uuid,uuid,text,integer,text),public.issue_checkin_qr_token(uuid,uuid,uuid) to authenticated;
