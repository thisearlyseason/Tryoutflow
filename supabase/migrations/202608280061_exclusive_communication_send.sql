-- A provider authorization is a single-use capability, not a replayable fact.
-- Existing handoffs are retained and enriched; new callers receive the opaque
-- token exactly once from the v2 authorization RPC.
alter table public.outbox_provider_handoffs
  add column message_id uuid,
  add column provider_idempotency_key text,
  add column send_attempt_token uuid not null default gen_random_uuid(),
  add column attempt_state text not null default 'authorized',
  add column resolved_at timestamptz,
  add column provider_message_id text;

update public.outbox_provider_handoffs handoff
set message_id=job.message_id,
  provider_idempotency_key=job.provider_idempotency_key,
  attempt_state=case
    when job.status='completed' then 'completed'
    when job.status='leased' and job.lease_expires_at is not null
      and handoff.started_at<=job.lease_expires_at and handoff.started_at<=clock_timestamp()
      then 'authorized'
    else 'delivery_uncertain'
  end,
  resolved_at=case
    when job.status='completed' then coalesce(job.completed_at,job.updated_at)
    when job.status='leased' and job.lease_expires_at is not null
      and handoff.started_at<=job.lease_expires_at and handoff.started_at<=clock_timestamp()
      then null
    else greatest(handoff.started_at,coalesce(job.delivery_uncertain_at,job.updated_at,clock_timestamp()))
  end,
  provider_message_id=case when job.status='completed' then message.provider_message_id end
from public.outbox_jobs job
join public.communication_messages message on message.id=job.message_id
where job.id=handoff.job_id;

alter table public.outbox_provider_handoffs
  alter column message_id set not null,
  alter column provider_idempotency_key set not null,
  add constraint outbox_provider_handoffs_attempt_token_key unique(send_attempt_token),
  add constraint outbox_provider_handoffs_attempt_identity_key
    unique(job_id,lease_token,lease_generation,send_attempt_token),
  add constraint outbox_provider_handoffs_message_fkey
    foreign key(organization_id,message_id)
    references public.communication_messages(organization_id,id) on delete restrict,
  add constraint outbox_provider_handoffs_attempt_state check(
    attempt_state in ('authorized','declined','provider_failed','completed','delivery_uncertain')
  ),
  add constraint outbox_provider_handoffs_resolution_shape check(
    (attempt_state='authorized' and resolved_at is null and provider_message_id is null)
    or (attempt_state in ('declined','provider_failed','delivery_uncertain') and resolved_at is not null and provider_message_id is null)
    or (attempt_state='completed' and resolved_at is not null and provider_message_id is not null)
  ),
  add constraint outbox_provider_handoffs_provider_key check(
    provider_idempotency_key ~ '^communication:[0-9a-f-]{36}$'
  ),
  add constraint outbox_provider_handoffs_provider_message check(
    provider_message_id is null or provider_message_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  add constraint outbox_provider_handoffs_time_order check(
    resolved_at is null or resolved_at>=started_at
  );

-- Migration-058 could leave provider-start markers in every job state. Repair
-- only rows whose exact current lease, immutable message and temporal lineage
-- are all provable. Every other variant is failed closed with a distinct code.
do $$
declare migration_clock timestamptz:=clock_timestamp();
begin
  insert into public.outbox_provider_handoffs(
    organization_id,job_id,message_id,lease_token,lease_generation,started_at,
    provider_idempotency_key,attempt_state,resolved_at
  )
  select job.organization_id,job.id,job.message_id,job.lease_token,job.lease_generation,
    job.provider_submission_started_at,job.provider_idempotency_key,
    'delivery_uncertain',migration_clock
  from public.outbox_jobs job
  join public.communication_messages message
    on message.organization_id=job.organization_id and message.id=job.message_id
  where job.provider_submission_started_at is not null
    and not exists(select 1 from public.outbox_provider_handoffs existing where existing.job_id=job.id)
    and job.lease_owner is not null and job.lease_token is not null
    and job.lease_generation>0 and job.lease_expires_at is not null
    and job.provider_submission_started_at>=job.created_at
    and job.provider_submission_started_at>=message.created_at
    and job.provider_submission_started_at<=job.lease_expires_at
    and job.provider_submission_started_at<=migration_clock
    and job.provider_idempotency_key='communication:'||message.id::text
    and job.business_idempotency_key=message.business_idempotency_key;

  with candidates as (
    select job.id,job.message_id,
      case
        when job.provider_submission_started_at>migration_clock then 'legacy_handoff_future_start'
        when job.lease_owner is null or job.lease_token is null or job.lease_generation<=0 or job.lease_expires_at is null
          then 'legacy_handoff_missing_lease'
        when job.provider_submission_started_at<job.created_at
          or job.provider_submission_started_at>job.lease_expires_at
          then 'legacy_handoff_temporal_invalid'
        when message.id is null or job.provider_idempotency_key is distinct from 'communication:'||message.id::text
          or job.business_idempotency_key is distinct from message.business_idempotency_key
          then 'legacy_handoff_binding_invalid'
        else 'legacy_handoff_repaired_uncertain'
      end reason
    from public.outbox_jobs job
    left join public.communication_messages message
      on message.organization_id=job.organization_id and message.id=job.message_id
    where job.provider_submission_started_at is not null
      and job.status in ('pending','leased','cancelled','dead_letter')
  ), marked_messages as (
    update public.communication_messages message
    set state='delivery_uncertain',attention_required_at=coalesce(message.attention_required_at,migration_clock),
      cancellation_reason=null
    from candidates candidate
    where message.id=candidate.message_id
      and message.state in ('queued','failed','cancelled','suppressed','delivery_uncertain')
    returning message.id
  )
  update public.outbox_jobs job
  set status='needs_attention',completed_at=null,dead_lettered_at=null,
    delivery_uncertain_at=coalesce(job.delivery_uncertain_at,migration_clock),
    delivery_uncertain_reason=candidate.reason,last_error_code=candidate.reason,
    lease_owner=null,lease_token=null,lease_expires_at=null
  from candidates candidate where job.id=candidate.id;
end $$;

-- Migration 060 correctly failed closed unprovable pending/leased rows but, by
-- design, cleared their unsafe lease material. Preserve that honest boundary:
-- future clocks remain distinguishable; all other erased variants are marked
-- as lineage-lost rather than being assigned invented lease provenance.
update public.outbox_jobs
set delivery_uncertain_reason=case
    when provider_submission_started_at>clock_timestamp() then 'legacy_handoff_future_start'
    else 'legacy_handoff_lineage_lost'
  end,
  last_error_code=case
    when provider_submission_started_at>clock_timestamp() then 'legacy_handoff_future_start'
    else 'legacy_handoff_lineage_lost'
  end
where status='needs_attention' and delivery_uncertain_reason='legacy_handoff_unprovable';

create function private.guard_outbox_handoff_insert() returns trigger
language plpgsql set search_path='' as $$
declare target public.outbox_jobs%rowtype;
begin
  if tg_op='UPDATE' then
    if new.organization_id<>old.organization_id or new.job_id<>old.job_id
      or new.message_id<>old.message_id or new.lease_token<>old.lease_token
      or new.lease_generation<>old.lease_generation
      or new.provider_idempotency_key<>old.provider_idempotency_key
      or new.send_attempt_token<>old.send_attempt_token or new.started_at<>old.started_at
      or old.attempt_state<>'authorized' or new.attempt_state='authorized'
    then raise exception 'provider attempt lineage is append-only' using errcode='55000'; end if;
    return new;
  end if;
  select * into target from public.outbox_jobs where id=new.job_id;
  if not found or target.organization_id<>new.organization_id or target.message_id<>new.message_id
    or target.provider_idempotency_key<>new.provider_idempotency_key
    or target.lease_token is distinct from new.lease_token
    or target.lease_generation<>new.lease_generation
    or target.lease_expires_at is null or new.started_at>target.lease_expires_at
    or new.started_at>clock_timestamp()
  then raise exception 'invalid provider attempt lineage' using errcode='23514'; end if;
  return new;
end $$;

create trigger guard_outbox_handoff_insert
before insert or update on public.outbox_provider_handoffs
for each row execute function private.guard_outbox_handoff_insert();
alter table public.outbox_provider_handoffs enable always trigger guard_outbox_handoff_insert;

create function private.deny_communication_truncate() returns trigger
language plpgsql set search_path='' as $$
begin
  raise exception 'communication evidence cannot be truncated' using errcode='55000';
end $$;
create trigger deny_communication_messages_truncate before truncate on public.communication_messages
for each statement execute function private.deny_communication_truncate();
create trigger deny_outbox_jobs_truncate before truncate on public.outbox_jobs
for each statement execute function private.deny_communication_truncate();
create trigger deny_outbox_handoffs_truncate before truncate on public.outbox_provider_handoffs
for each statement execute function private.deny_communication_truncate();
alter table public.communication_messages enable always trigger deny_communication_messages_truncate;
alter table public.outbox_jobs enable always trigger deny_outbox_jobs_truncate;
alter table public.outbox_provider_handoffs enable always trigger deny_outbox_handoffs_truncate;

alter table public.communication_messages drop constraint communication_messages_organization_id_fkey;
alter table public.communication_messages add constraint communication_messages_organization_id_fkey
  foreign key(organization_id) references public.organizations(id) on delete restrict;
alter table public.outbox_jobs drop constraint outbox_jobs_message_fkey;
alter table public.outbox_jobs add constraint outbox_jobs_message_fkey
  foreign key(organization_id,message_id)
  references public.communication_messages(organization_id,id) on delete restrict;
alter table public.outbox_provider_handoffs
  drop constraint outbox_provider_handoffs_organization_id_job_id_fkey;
alter table public.outbox_provider_handoffs
  add constraint outbox_provider_handoffs_organization_id_job_id_fkey
  foreign key(organization_id,job_id)
  references public.outbox_jobs(organization_id,id) on delete restrict;

create function private.guard_communication_evidence_delete() returns trigger
language plpgsql set search_path='' as $$
begin
  if exists(select 1 from public.communication_messages where organization_id=old.id) then
    raise exception 'organizations with communication evidence cannot be deleted' using errcode='55000';
  end if;
  return old;
end $$;
create trigger aa_guard_organization_communication_delete before delete on public.organizations
for each row execute function private.guard_communication_evidence_delete();
alter table public.organizations enable always trigger aa_guard_organization_communication_delete;

create function public.authorize_outbox_job_send_v2(
  p_job_id uuid,p_lease_token uuid,p_lease_generation bigint,
  p_provider_timeout_ms integer,p_safety_margin_ms integer
) returns jsonb language plpgsql security definer set search_path='' as $$
declare seed record; target public.outbox_jobs%rowtype; reason text; now_at timestamptz;
  attempt_token uuid; budget_ms integer;
begin
  if auth.role()<>'service_role' then raise exception 'forbidden' using errcode='42501'; end if;
  if p_provider_timeout_ms not between 1000 and 120000 or p_safety_margin_ms not between 1000 and 60000
    or p_provider_timeout_ms+p_safety_margin_ms>180000
  then return jsonb_build_object('outcome','invalid_input','send_attempt_token',null,'send_budget_ms',0); end if;
  select message_id into seed from public.outbox_jobs where id=p_job_id;
  if not found then return jsonb_build_object('outcome','not_found','send_attempt_token',null,'send_budget_ms',0); end if;
  perform private.lock_communication_primary_source(seed.message_id);
  reason:=private.lock_communication_source_reason(seed.message_id);
  select * into target from public.outbox_jobs where id=p_job_id for update;
  now_at:=clock_timestamp();
  if target.status<>'leased' or target.lease_token is distinct from p_lease_token
    or target.lease_generation<>p_lease_generation or target.lease_expires_at<=now_at
  then return jsonb_build_object('outcome','lease_conflict','send_attempt_token',null,'send_budget_ms',0); end if;
  if reason is not null then
    perform private.cancel_outbox_message(target.id,reason);
    return jsonb_build_object('outcome',case when target.provider_submission_started_at is null then 'cancelled' else 'needs_attention' end,
      'send_attempt_token',null,'send_budget_ms',0);
  end if;
  if exists(select 1 from public.outbox_provider_handoffs handoff where handoff.job_id=target.id
    and handoff.lease_token=p_lease_token and handoff.lease_generation=p_lease_generation)
  then return jsonb_build_object('outcome','in_progress','send_attempt_token',null,'send_budget_ms',0); end if;
  if exists(select 1 from public.outbox_provider_handoffs handoff where handoff.job_id=target.id
    and handoff.attempt_state in ('authorized','delivery_uncertain'))
  then
    perform private.mark_outbox_delivery_uncertain(target.id,'prior_handoff_unresolved');
    return jsonb_build_object('outcome','needs_attention','send_attempt_token',null,'send_budget_ms',0);
  end if;
  if target.lease_expires_at-now_at < make_interval(secs=>(p_provider_timeout_ms+p_safety_margin_ms)::double precision/1000.0)
  then return jsonb_build_object('outcome','insufficient_budget','send_attempt_token',null,'send_budget_ms',0); end if;
  budget_ms:=least(p_provider_timeout_ms,floor(extract(epoch from (target.lease_expires_at-now_at))*1000-p_safety_margin_ms)::integer);
  attempt_token:=gen_random_uuid();
  insert into public.outbox_provider_handoffs(
    organization_id,job_id,message_id,lease_token,lease_generation,started_at,
    provider_idempotency_key,send_attempt_token,attempt_state
  ) values(target.organization_id,target.id,target.message_id,p_lease_token,p_lease_generation,now_at,
    target.provider_idempotency_key,attempt_token,'authorized');
  update public.outbox_jobs set provider_submission_started_at=coalesce(provider_submission_started_at,now_at)
    where id=target.id;
  return jsonb_build_object('outcome','authorized','send_attempt_token',attempt_token,'send_budget_ms',budget_ms);
end $$;

create function public.decline_outbox_job_send_v2(
  p_job_id uuid,p_lease_token uuid,p_lease_generation bigint,p_send_attempt_token uuid,p_reason text
) returns text language plpgsql security definer set search_path='' as $$
declare target public.outbox_jobs%rowtype; changed uuid;
begin
  if auth.role()<>'service_role' then raise exception 'forbidden' using errcode='42501'; end if;
  if p_reason<>'provider_deadline_elapsed' then return 'invalid_input'; end if;
  select * into target from public.outbox_jobs where id=p_job_id for update;
  if not found then return 'not_found'; end if;
  if target.status<>'leased' or target.lease_token is distinct from p_lease_token or target.lease_generation<>p_lease_generation
    then return 'lease_conflict'; end if;
  update public.outbox_provider_handoffs set attempt_state='declined',resolved_at=clock_timestamp()
  where job_id=p_job_id and lease_token=p_lease_token and lease_generation=p_lease_generation
    and send_attempt_token=p_send_attempt_token and attempt_state='authorized'
  returning send_attempt_token into changed;
  if changed is null then return 'attempt_conflict'; end if;
  if exists(select 1 from public.outbox_provider_handoffs where job_id=p_job_id
    and send_attempt_token<>p_send_attempt_token and attempt_state in ('authorized','delivery_uncertain'))
  then
    perform private.mark_outbox_delivery_uncertain(p_job_id,'prior_handoff_unresolved');
    return 'needs_attention';
  end if;
  update public.outbox_jobs set status='pending',available_at=clock_timestamp()+interval '30 seconds',
    last_error_code=p_reason,provider_submission_started_at=null,lease_owner=null,lease_token=null,lease_expires_at=null
  where id=p_job_id;
  return 'retry_scheduled';
end $$;

create function public.complete_outbox_job_v2(
  p_job_id uuid,p_lease_token uuid,p_lease_generation bigint,p_send_attempt_token uuid,p_provider_message_id text
) returns text language plpgsql security definer set search_path='' as $$
declare seed record; target public.outbox_jobs%rowtype; attempt public.outbox_provider_handoffs%rowtype;
begin
  if auth.role()<>'service_role' then raise exception 'forbidden' using errcode='42501'; end if;
  if p_provider_message_id is null or p_provider_message_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    then return 'invalid_input'; end if;
  select message_id into seed from public.outbox_jobs where id=p_job_id;
  if not found then return 'not_found'; end if;
  perform private.lock_communication_primary_source(seed.message_id);
  perform 1 from public.communication_messages where id=seed.message_id for update;
  select * into target from public.outbox_jobs where id=p_job_id for update;
  select * into attempt from public.outbox_provider_handoffs where job_id=p_job_id
    and lease_token=p_lease_token and lease_generation=p_lease_generation
    and send_attempt_token=p_send_attempt_token for update;
  if not found then return 'attempt_conflict'; end if;
  if attempt.attempt_state='completed' then return case when attempt.provider_message_id=p_provider_message_id then 'replayed' else 'terminal_conflict' end; end if;
  if attempt.attempt_state<>'authorized' then return 'attempt_conflict'; end if;
  if target.status not in ('leased','pending','needs_attention') then return 'lease_conflict'; end if;
  update public.outbox_provider_handoffs set attempt_state='completed',resolved_at=clock_timestamp(),provider_message_id=p_provider_message_id
    where send_attempt_token=p_send_attempt_token;
  update public.outbox_jobs set status='completed',completed_at=clock_timestamp(),dead_lettered_at=null,
    delivery_uncertain_at=null,delivery_uncertain_reason=null,last_error_code=null,
    lease_owner=null,lease_token=null,lease_expires_at=null where id=p_job_id;
  update public.communication_messages set state='submitted',provider_message_id=p_provider_message_id,
    submitted_at=clock_timestamp(),attention_required_at=null,cancellation_reason=null where id=target.message_id;
  return 'completed';
end $$;

create function public.fail_outbox_job_v2(
  p_job_id uuid,p_lease_token uuid,p_lease_generation bigint,p_send_attempt_token uuid,
  p_error_code text,p_retryable boolean
) returns text language plpgsql security definer set search_path='' as $$
declare target public.outbox_jobs%rowtype; changed uuid; terminal boolean;
begin
  if auth.role()<>'service_role' then raise exception 'forbidden' using errcode='42501'; end if;
  if p_error_code !~ '^[a-z][a-z0-9_]{2,63}$' then return 'invalid_input'; end if;
  select * into target from public.outbox_jobs where id=p_job_id for update;
  if not found then return 'not_found'; end if;
  if target.status<>'leased' or target.lease_token is distinct from p_lease_token or target.lease_generation<>p_lease_generation
    then return 'lease_conflict'; end if;
  if p_error_code='provider_timeout_uncertain' then
    update public.outbox_provider_handoffs set attempt_state='delivery_uncertain',resolved_at=clock_timestamp()
    where job_id=p_job_id and send_attempt_token=p_send_attempt_token and attempt_state='authorized' returning send_attempt_token into changed;
    if changed is null then return 'attempt_conflict'; end if;
    perform private.mark_outbox_delivery_uncertain(p_job_id,p_error_code);
    return 'needs_attention';
  end if;
  update public.outbox_provider_handoffs set attempt_state='provider_failed',resolved_at=clock_timestamp()
  where job_id=p_job_id and send_attempt_token=p_send_attempt_token and attempt_state='authorized' returning send_attempt_token into changed;
  if changed is null then return 'attempt_conflict'; end if;
  terminal:=not p_retryable or target.attempt_count>=target.max_attempts;
  if terminal then
    update public.outbox_jobs set status='dead_letter',last_error_code=p_error_code,dead_lettered_at=clock_timestamp(),
      provider_submission_started_at=null,lease_owner=null,lease_token=null,lease_expires_at=null where id=p_job_id;
    update public.communication_messages set state='failed',attention_required_at=clock_timestamp() where id=target.message_id;
    return 'dead_lettered';
  end if;
  update public.outbox_jobs set status='pending',last_error_code=p_error_code,provider_submission_started_at=null,
    lease_owner=null,lease_token=null,lease_expires_at=null,
    available_at=clock_timestamp()+make_interval(secs=>least(3600,
      30*(2::numeric^greatest(0,target.attempt_count-1))
      +((hashtextextended(target.id::text||':'||target.lease_generation::text,0)&1023)%11))::integer)
  where id=p_job_id;
  return 'retry_scheduled';
end $$;

revoke all on function public.authorize_outbox_job_send(uuid,uuid,bigint),
  public.complete_outbox_job(uuid,uuid,bigint,text),
  public.fail_outbox_job(uuid,uuid,bigint,text,boolean),
  public.decline_outbox_job_send(uuid,uuid,bigint,text)
from public,anon,authenticated,service_role;
revoke all on function public.authorize_outbox_job_send_v2(uuid,uuid,bigint,integer,integer),
  public.complete_outbox_job_v2(uuid,uuid,bigint,uuid,text),
  public.fail_outbox_job_v2(uuid,uuid,bigint,uuid,text,boolean),
  public.decline_outbox_job_send_v2(uuid,uuid,bigint,uuid,text)
from public,anon,authenticated,service_role;
grant execute on function public.authorize_outbox_job_send_v2(uuid,uuid,bigint,integer,integer),
  public.complete_outbox_job_v2(uuid,uuid,bigint,uuid,text),
  public.fail_outbox_job_v2(uuid,uuid,bigint,uuid,text,boolean),
  public.decline_outbox_job_send_v2(uuid,uuid,bigint,uuid,text)
to service_role;

revoke all on public.outbox_provider_handoffs from public,anon,authenticated,service_role;
revoke all on function private.guard_outbox_handoff_insert(),private.deny_communication_truncate(),
  private.guard_communication_evidence_delete()
from public,anon,authenticated,service_role;
