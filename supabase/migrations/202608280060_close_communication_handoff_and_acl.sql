-- Recover only migration-058 provider starts whose exact lease lineage and
-- immutable message binding are still provable.  Anything else is explicitly
-- uncertain rather than being given invented completion authority.
insert into public.outbox_provider_handoffs(
  organization_id,job_id,lease_token,lease_generation,started_at
)
select job.organization_id,job.id,job.lease_token,job.lease_generation,
  job.provider_submission_started_at
from public.outbox_jobs job
join public.communication_messages message
  on message.organization_id=job.organization_id and message.id=job.message_id
where job.provider_submission_started_at is not null
  and job.status='leased'
  and job.lease_owner is not null
  and job.lease_token is not null
  and job.lease_generation>0
  and job.lease_expires_at is not null
  and job.provider_idempotency_key='communication:'||message.id::text
  and job.business_idempotency_key=message.business_idempotency_key
  and message.state='queued'
  and job.provider_submission_started_at>=job.created_at
  and job.provider_submission_started_at>=message.created_at
on conflict do nothing;

with unprovable as (
  select job.id,job.message_id
  from public.outbox_jobs job
  where job.provider_submission_started_at is not null
    and job.status in ('pending','leased')
    and not exists(
      select 1 from public.outbox_provider_handoffs handoff
      where handoff.job_id=job.id
    )
), marked_messages as (
  update public.communication_messages message
  set state='delivery_uncertain',attention_required_at=coalesce(attention_required_at,clock_timestamp()),
    cancellation_reason=null
  from unprovable
  where message.id=unprovable.message_id and message.state='queued'
  returning message.id
)
update public.outbox_jobs job
set status='needs_attention',last_error_code='legacy_handoff_unprovable',
  delivery_uncertain_at=coalesce(delivery_uncertain_at,clock_timestamp()),
  delivery_uncertain_reason='legacy_handoff_unprovable',
  lease_owner=null,lease_token=null,lease_expires_at=null
from unprovable
where job.id=unprovable.id;

-- The provider was never invoked when this RPC is called.  Exact fencing and
-- the job lock make that fact durable without erasing another worker's handoff.
create function public.decline_outbox_job_send(
  p_job_id uuid,p_lease_token uuid,p_lease_generation bigint,p_reason text
) returns text language plpgsql security definer set search_path='' as $$
declare target public.outbox_jobs%rowtype;
begin
  if auth.role()<>'service_role' then raise exception 'forbidden' using errcode='42501'; end if;
  if p_reason not in ('provider_deadline_elapsed') then return 'invalid_input'; end if;
  select * into target from public.outbox_jobs where id=p_job_id for update;
  if not found then return 'not_found'; end if;
  if target.status<>'leased' or target.lease_token is distinct from p_lease_token
    or target.lease_generation<>p_lease_generation then return 'lease_conflict'; end if;
  if not exists(
    select 1 from public.outbox_provider_handoffs handoff
    where handoff.job_id=target.id and handoff.lease_token=p_lease_token
      and handoff.lease_generation=p_lease_generation
  ) then return 'lease_conflict'; end if;
  if exists(
    select 1 from public.outbox_provider_handoffs handoff
    where handoff.job_id=target.id
      and (handoff.lease_token,handoff.lease_generation)<>(p_lease_token,p_lease_generation)
  ) then return 'handoff_conflict'; end if;
  delete from public.outbox_provider_handoffs handoff
  where handoff.job_id=target.id and handoff.lease_token=p_lease_token
    and handoff.lease_generation=p_lease_generation;
  update public.outbox_jobs
  set status='pending',available_at=clock_timestamp()+interval '30 seconds',
    last_error_code=p_reason,provider_submission_started_at=null,
    lease_owner=null,lease_token=null,lease_expires_at=null
  where id=target.id;
  return 'retry_scheduled';
end $$;

revoke all on function public.decline_outbox_job_send(uuid,uuid,bigint,text)
  from public,anon,authenticated,service_role;
grant execute on function public.decline_outbox_job_send(uuid,uuid,bigint,text) to service_role;

-- Operational state is append-only from every client role.  Queue, claim,
-- authorization, decline, completion and failure all cross constrained
-- SECURITY DEFINER RPC boundaries owned by the migration role.
revoke insert,update,delete,truncate,references,trigger,maintain
  on public.communication_messages,public.outbox_jobs
  from public,anon,authenticated,service_role;
revoke select on public.communication_messages,public.outbox_jobs from service_role;
