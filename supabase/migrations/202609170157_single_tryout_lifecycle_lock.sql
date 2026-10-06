-- A single purchase is consumed by one published event. Its boundary survives refunds,
-- renewed receipts and plan changes; source records remain available for reading/export.
create table private.single_tryout_events (
 organization_id uuid not null,
 tryout_id uuid not null,
 environment text not null check(environment in ('sandbox','production')),
 identity_snapshot jsonb not null,
 schedule_snapshot jsonb not null,
 first_session_at timestamptz not null,
 last_session_at timestamptz not null,
 locks_at timestamptz not null,
 sealed_at timestamptz not null default clock_timestamp(),
 primary key(organization_id,tryout_id,environment),
 foreign key(organization_id,tryout_id) references public.tryouts(organization_id,id),
 check(last_session_at>=first_session_at and locks_at>=last_session_at)
);
alter table private.single_tryout_events enable row level security;
revoke all on private.single_tryout_events from public,anon,authenticated,service_role;
create trigger single_tryout_event_immutable before update or delete or truncate on private.single_tryout_events
for each statement execute function private.deny_billing_history_mutation();

create function private.has_single_tryout_purchase(p_org uuid,p_tryout uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.billing_contracts c where c.organization_id=p_org and c.tryout_id=p_tryout
   and c.product_key='single_tryout_pro' and c.environment=(select environment from private.billing_configuration))
 or exists(select 1 from public.billing_overrides o where o.organization_id=p_org and o.tryout_id=p_tryout
   and o.product_key='single_tryout_pro');
$$;

create function private.seal_single_tryout(p_org uuid,p_tryout uuid)
returns void language plpgsql security definer set search_path='' as $$
declare t public.tryouts%rowtype; first_at timestamptz; last_at timestamptz; env text;
begin
 select * into t from public.tryouts where organization_id=p_org and id=p_tryout for update;
 if not found then return; end if;
 select environment into env from private.billing_configuration;
 if t.status='draft' or not private.has_single_tryout_purchase(p_org,p_tryout)
   or exists(select 1 from private.single_tryout_events where organization_id=p_org and tryout_id=p_tryout and environment=env) then return; end if;
 select min(starts_at),max(ends_at) into first_at,last_at from public.tryout_sessions where organization_id=p_org and tryout_id=p_tryout;
 if first_at is null or last_at is null or last_at-first_at>interval '14 days'
   or t.registration_ends_at>last_at then
   raise exception 'single_tryout_schedule_invalid' using errcode='42501';
 end if;
 insert into private.single_tryout_events(organization_id,tryout_id,environment,identity_snapshot,schedule_snapshot,first_session_at,last_session_at,locks_at)
 values(p_org,p_tryout,env,to_jsonb(t)-array['status','version','updated_at','finalized_at'],
   (select jsonb_agg(to_jsonb(s) order by s.starts_at,s.id) from public.tryout_sessions s where s.organization_id=p_org and s.tryout_id=p_tryout),
   first_at,last_at,last_at+interval '7 days');
end $$;

create function private.capture_single_tryout_event() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if TG_TABLE_NAME='tryouts' then perform private.seal_single_tryout(new.organization_id,new.id);
 elsif new.product_key='single_tryout_pro' and new.tryout_id is not null then
   perform private.seal_single_tryout(new.organization_id,new.tryout_id);
 end if;
 return new;
end $$;
create trigger single_tryout_capture after insert or update on public.tryouts for each row execute function private.capture_single_tryout_event();
create trigger single_tryout_capture after insert or update on public.billing_contracts for each row execute function private.capture_single_tryout_event();
create trigger single_tryout_capture after insert or update on public.billing_overrides for each row execute function private.capture_single_tryout_event();

-- Serialize all event writes with completion, including writes made inside security-definer
-- RPCs. A client flag, trigger depth, service role or expired subscription cannot bypass it.
create function private.assert_single_tryout_writable(p_org uuid,p_tryout uuid)
returns void language plpgsql security definer set search_path='' as $$
declare t public.tryouts%rowtype; license private.single_tryout_events%rowtype;
begin
 if p_tryout is null then return; end if;
 select * into t from public.tryouts where organization_id=p_org and id=p_tryout for update;
 select * into license from private.single_tryout_events where organization_id=p_org and tryout_id=p_tryout
   and environment=(select environment from private.billing_configuration);
 if found and (t.status='finalized' or clock_timestamp()>=license.locks_at) then
   raise exception 'single_tryout_locked' using errcode='42501';
 end if;
end $$;

-- Resolve old AND new scopes so moving a child cannot escape a locked parent.
create function private.single_tryout_row_scope(p_table text,p_row jsonb)
returns uuid language sql stable security definer set search_path='' as $$
 select case
 when p_table='tryouts' then (p_row->>'id')::uuid
 when p_row ? 'tryout_id' then (p_row->>'tryout_id')::uuid
 when p_table in ('evaluation_notes','evaluation_note_tags','evaluation_mutations') then
   (select tryout_id from public.evaluations where organization_id=(p_row->>'organization_id')::uuid and id=(p_row->>'evaluation_id')::uuid)
 when p_table='performance_results' then
   (select tryout_id from public.tryout_sessions where organization_id=(p_row->>'organization_id')::uuid and id=(p_row->>'session_id')::uuid)
 when p_table='roster_scenario_members' then
   (select tryout_id from public.roster_scenarios where organization_id=(p_row->>'organization_id')::uuid and id=(p_row->>'scenario_id')::uuid)
 when p_table='communication_batches' then
   (select tryout_id from public.roster_versions where organization_id=(p_row->>'organization_id')::uuid and id=(p_row->>'roster_version_id')::uuid)
 when p_table='communication_messages' then coalesce((p_row->>'source_tryout_id')::uuid,
   (select tryout_id from public.tryout_registrations where organization_id=(p_row->>'organization_id')::uuid and id=(p_row->>'source_registration_id')::uuid),
   (select tryout_id from public.roster_versions where organization_id=(p_row->>'organization_id')::uuid and id=(p_row->>'source_roster_version_id')::uuid))
 when p_table in ('registration_confirmation_tokens','registration_duplicate_candidates') then
   (select tryout_id from public.tryout_registrations where organization_id=(p_row->>'organization_id')::uuid and id=(p_row->>'registration_id')::uuid)
 end;
$$;

create function private.guard_single_tryout_write() returns trigger
language plpgsql security definer set search_path='' as $$
declare r jsonb; prior jsonb; scope uuid; org uuid; sealed boolean; status text;
begin
 r:=case when TG_OP='DELETE' then to_jsonb(old) else to_jsonb(new) end;
 prior:=case when TG_OP='INSERT' then r else to_jsonb(old) end;
 -- Previously queued messages may finish delivery; no new content or recipients can be queued.
 if TG_TABLE_NAME='communication_messages' and TG_OP='UPDATE'
   and (r-array['state','provider_message_id','submitted_at','attention_required_at','updated_at','cancellation_reason','delivery_state_at'])
     is not distinct from (prior-array['state','provider_message_id','submitted_at','attention_required_at','updated_at','cancellation_reason','delivery_state_at']) then return new; end if;
 -- Revoking staff access remains possible for security after completion.
 if TG_TABLE_NAME='tryout_staff_assignments' and TG_OP='UPDATE' and r->>'revoked_at' is not null
   and (r-array['revoked_at','updated_at']) is not distinct from (prior-array['revoked_at','updated_at']) then return new; end if;
 foreach r in array case when TG_OP='UPDATE' then array[prior,r] else array[r] end loop
  org:=(r->>'organization_id')::uuid;
  scope:=private.single_tryout_row_scope(TG_TABLE_NAME,r);
  if scope is null then continue; end if;
  select t.status into status from public.tryouts t where t.organization_id=org and t.id=scope for update;
  select exists(select 1 from private.single_tryout_events where organization_id=org and tryout_id=scope
    and environment=(select environment from private.billing_configuration)) into sealed;
  if not sealed then continue; end if;
  -- Completion is the only permitted root change; it also remains possible after automatic expiry.
  if TG_TABLE_NAME='tryouts' and TG_OP='UPDATE' and to_jsonb(old)->>'status'='published' and to_jsonb(new)->>'status'='finalized'
    and (to_jsonb(new)-array['status','finalized_at','version','updated_at']) is not distinct from
        (to_jsonb(old)-array['status','finalized_at','version','updated_at']) then continue; end if;
  perform private.assert_single_tryout_writable(org,scope);
  if TG_TABLE_NAME in ('tryouts','tryout_sessions','tryout_divisions','tryout_positions') then
   if TG_OP<>'UPDATE' or (to_jsonb(new)-array['updated_at','version']) is distinct from (to_jsonb(old)-array['updated_at','version']) then
    raise exception 'single_tryout_identity_locked' using errcode='42501';
   end if;
  end if;
  -- A station cannot become a disguised extra session outside the purchased schedule.
  if TG_TABLE_NAME='tryout_stations' and TG_OP<>'DELETE' and exists(
    select 1 from private.single_tryout_events l where l.organization_id=org and l.tryout_id=scope
      and l.environment=(select environment from private.billing_configuration)
      and ((r->>'starts_at')::timestamptz<l.first_session_at or (r->>'ends_at')::timestamptz>l.last_session_at)) then
    raise exception 'single_tryout_identity_locked' using errcode='42501';
  end if;
 end loop;
 return coalesce(new,old);
end $$;

-- Event-scoped operational rows. Billing, audit evidence, read projections and rate-limit
-- counters are intentionally excluded; they never grant permission to edit a source event.
do $$ declare t text; begin
 foreach t in array array[
  'tryouts','tryout_sessions','tryout_divisions','tryout_positions','tryout_setup_progress','session_groups',
  'registration_forms','registration_form_versions','tryout_registration_form_selections','tryout_publications',
  'tryout_registrations','session_enrollments','checkins','checkin_qr_tokens','tryout_numbers',
  'rubrics','rubric_versions','rubric_categories','session_rubrics','evaluations','evaluation_scores',
  'evaluation_notes','evaluation_note_tags','evaluation_mutations','athlete_flags','tryout_staff_assignments',
  'tryout_teams','roster_versions','roster_assignments','roster_decisions','decision_history',
  'roster_scenarios','roster_scenario_members','tryout_stations','performance_results',
  'event_eligibility_policies','eligibility_exceptions','event_fees','event_notices',
  'communication_preview_proofs','communication_batches','communication_messages',
  'registration_confirmation_tokens','registration_duplicate_candidates'
 ] loop
  execute format('create trigger a_single_tryout_boundary before insert or update or delete on public.%I for each row execute function private.guard_single_tryout_write()',t);
 end loop;
end $$;

-- Renaming the season or the athletes referenced by a locked result must not rewrite history.
create function private.guard_single_tryout_shared_identity() returns trigger
language plpgsql security definer set search_path='' as $$
declare scope uuid;
begin
 if TG_TABLE_NAME='seasons' then
  for scope in select t.id from public.tryouts t join private.single_tryout_events l on l.organization_id=t.organization_id and l.tryout_id=t.id
    where t.organization_id=old.organization_id and t.season_id=old.id and l.environment=(select environment from private.billing_configuration) loop
   raise exception 'single_tryout_identity_locked' using errcode='42501';
  end loop;
 elsif TG_TABLE_NAME='athletes' then
  for scope in select distinct r.tryout_id from public.tryout_registrations r where r.organization_id=old.organization_id and r.athlete_id=old.id order by r.tryout_id loop
   perform private.assert_single_tryout_writable(old.organization_id,scope);
  end loop;
 end if;
 return coalesce(new,old);
end $$;
create trigger a_single_tryout_boundary before update or delete on public.seasons for each row execute function private.guard_single_tryout_shared_identity();
create trigger a_single_tryout_boundary before update or delete on public.athletes for each row execute function private.guard_single_tryout_shared_identity();

-- Readable by authorized event members; never expose billing identifiers or private snapshots.
create function public.get_single_tryout_lifecycle(p_organization_id uuid,p_tryout_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare t public.tryouts%rowtype; l private.single_tryout_events%rowtype;
begin
 if not public.can_read_tryout_configuration(p_organization_id,p_tryout_id) then raise exception 'forbidden' using errcode='42501'; end if;
 select * into t from public.tryouts where organization_id=p_organization_id and id=p_tryout_id;
 select * into l from private.single_tryout_events where organization_id=p_organization_id and tryout_id=p_tryout_id
   and environment=(select environment from private.billing_configuration);
 if not found then return jsonb_build_object('single',private.has_single_tryout_purchase(p_organization_id,p_tryout_id),'sealed',false,'locked',false); end if;
 return jsonb_build_object('version',t.version,'single',true,'sealed',true,'locked',t.status='finalized' or now()>=l.locks_at,
   'locksAt',l.locks_at,'completedAt',t.finalized_at,'lastSessionAt',l.last_session_at);
end $$;

create function public.complete_single_tryout(p_organization_id uuid,p_tryout_id uuid,p_expected_version integer)
returns text language plpgsql security definer set search_path='' as $$
declare t public.tryouts%rowtype;
begin
 if not public.can_manage_tryout_root(p_organization_id,p_tryout_id) then raise exception 'forbidden' using errcode='42501'; end if;
 select * into t from public.tryouts where organization_id=p_organization_id and id=p_tryout_id for update;
 if not exists(select 1 from private.single_tryout_events where organization_id=p_organization_id and tryout_id=p_tryout_id
   and environment=(select environment from private.billing_configuration)) then return 'not_single'; end if;
 if t.status='finalized' then return 'completed'; end if;
 if t.version<>p_expected_version or t.status<>'published' then return 'conflict'; end if;
 update public.tryouts set status='finalized',finalized_at=clock_timestamp() where organization_id=p_organization_id and id=p_tryout_id;
 insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id)
 values(p_organization_id,auth.uid(),'tryout.single_completed','tryout',p_tryout_id);
 return 'completed';
end $$;

-- A new purchase for a completed event must not promise to unlock it. Provider receipt
-- reconciliation is still allowed and cannot modify the sealed event ledger.
create function private.guard_single_tryout_checkout() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.product_key='single_tryout_pro' then
  if new.tryout_id is null then raise exception 'tryout_required' using errcode='42501'; end if;
  perform private.assert_single_tryout_writable(new.organization_id,new.tryout_id);
  if exists(select 1 from public.tryouts where organization_id=new.organization_id and id=new.tryout_id and status='finalized') then
   raise exception 'single_tryout_locked' using errcode='42501';
  end if;
 end if;
 return new;
end $$;
create trigger a_single_tryout_checkout before insert on private.billing_purchase_intents for each row execute function private.guard_single_tryout_checkout();

revoke all on function private.has_single_tryout_purchase(uuid,uuid),private.seal_single_tryout(uuid,uuid),private.capture_single_tryout_event(),
 private.assert_single_tryout_writable(uuid,uuid),private.single_tryout_row_scope(text,jsonb),private.guard_single_tryout_write(),
 private.guard_single_tryout_shared_identity(),private.guard_single_tryout_checkout(),public.get_single_tryout_lifecycle(uuid,uuid),public.complete_single_tryout(uuid,uuid,integer)
from public,anon,authenticated,service_role;
grant execute on function public.get_single_tryout_lifecycle(uuid,uuid),public.complete_single_tryout(uuid,uuid,integer) to authenticated;

-- Existing purchases retain their event and results. Abort migration on an invalid legacy
-- schedule so it can be reviewed instead of silently inventing a new license window.
select private.seal_single_tryout(organization_id,id) from public.tryouts where status<>'draft' and private.has_single_tryout_purchase(organization_id,id);
alter table public.billing_contracts add constraint single_purchase_requires_event check(product_key<>'single_tryout_pro' or tryout_id is not null);
alter table public.billing_overrides add constraint single_override_requires_event check(product_key<>'single_tryout_pro' or tryout_id is not null);
create function private.guard_single_override_binding() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if old.product_key='single_tryout_pro' and (old.organization_id,old.tryout_id,old.product_key) is distinct from (new.organization_id,new.tryout_id,new.product_key) then
  raise exception 'purchase_ownership_immutable' using errcode='42501';
 end if;
 return new;
end $$;
revoke all on function private.guard_single_override_binding() from public,anon,authenticated,service_role;
create trigger single_override_binding before update on public.billing_overrides for each row execute function private.guard_single_override_binding();
create trigger a_single_tryout_boundary before insert or update or delete on private.registration_notification_settings for each row execute function private.guard_single_tryout_write();
create function private.validate_single_tryout_checkout(p_org uuid,p_tryout uuid)
returns void language plpgsql security definer set search_path='' as $$
declare t public.tryouts%rowtype; first_at timestamptz; last_at timestamptz;
begin
 if p_tryout is null then raise exception 'tryout_required' using errcode='42501'; end if;
 select * into t from public.tryouts where organization_id=p_org and id=p_tryout for update;
 if not found then raise exception 'forbidden' using errcode='42501'; end if;
 perform private.assert_single_tryout_writable(p_org,p_tryout);
 if t.status='finalized' then raise exception 'single_tryout_locked' using errcode='42501'; end if;
 select min(starts_at),max(ends_at) into first_at,last_at from public.tryout_sessions where organization_id=p_org and tryout_id=p_tryout;
 if (last_at-first_at>interval '14 days') or t.registration_ends_at>last_at
   or (t.status='published' and (first_at is null or last_at+interval '7 days'<=clock_timestamp())) then
  raise exception 'single_tryout_schedule_invalid' using errcode='42501';
 end if;
end $$;
revoke all on function private.validate_single_tryout_checkout(uuid,uuid) from public,anon,authenticated,service_role;
create or replace function private.guard_single_tryout_checkout() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.product_key='single_tryout_pro' then perform private.validate_single_tryout_checkout(new.organization_id,new.tryout_id); end if;
 return new;
end $$;
do $$ declare source text; needle text:='select * into i from private.billing_purchase_intents where id=p_id;'; begin
 select pg_get_functiondef('public.reserve_billing_purchase(uuid,uuid,uuid,text,text)'::regprocedure) into source;
 if position(needle in source)=0 then raise exception 'checkout_contract_changed'; end if;
 execute replace(source,needle,'if p_product_key=''single_tryout_pro'' then perform private.validate_single_tryout_checkout(p_organization_id,p_tryout_id); end if; '||needle);
end $$;
