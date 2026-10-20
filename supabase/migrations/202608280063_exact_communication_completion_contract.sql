-- Provider submission identifiers have one exact contract in the adapter,
-- dispatcher, completion RPC, constraints, and historical repair: canonical
-- lowercase RFC 4122 UUIDs, versions 1-5, with the RFC variant.
create function private.is_canonical_provider_message_id(p_value text) returns boolean
language sql immutable parallel safe set search_path='' as $$
  select p_value is not null
    and p_value ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
$$;

revoke all on function private.is_canonical_provider_message_id(text)
from public,anon,authenticated,service_role;

alter table public.outbox_provider_handoffs
  drop constraint outbox_provider_handoffs_provider_message;
alter table public.outbox_provider_handoffs
  add constraint outbox_provider_handoffs_provider_message check(
    provider_message_id is null or private.is_canonical_provider_message_id(provider_message_id)
  );

alter table public.outbox_jobs add column legacy_completion_evidence jsonb;
comment on column public.outbox_jobs.legacy_completion_evidence is
  'Exact non-content provider/timestamp lineage retained when a historical completed claim fails validation.';

create or replace function public.complete_outbox_job_v2(
  p_job_id uuid,p_lease_token uuid,p_lease_generation bigint,p_send_attempt_token uuid,
  p_provider_message_id text
) returns text language plpgsql security definer set search_path='' as $$
declare seed record; target public.outbox_jobs%rowtype; attempt public.outbox_provider_handoffs%rowtype;
begin
  if auth.role()<>'service_role' then raise exception 'forbidden' using errcode='42501'; end if;
  if not private.is_canonical_provider_message_id(p_provider_message_id) then return 'invalid_input'; end if;
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
  update public.outbox_provider_handoffs
  set attempt_state='completed',resolved_at=clock_timestamp(),provider_message_id=p_provider_message_id
  where send_attempt_token=p_send_attempt_token;
  update public.outbox_jobs set status='completed',completed_at=clock_timestamp(),dead_lettered_at=null,
    delivery_uncertain_at=null,delivery_uncertain_reason=null,last_error_code=null,
    lease_owner=null,lease_token=null,lease_expires_at=null where id=p_job_id;
  update public.communication_messages set state='submitted',provider_message_id=p_provider_message_id,
    submitted_at=clock_timestamp(),attention_required_at=null,cancellation_reason=null
  where id=target.message_id;
  return 'completed';
end $$;

-- Re-run the one-time repair using the completed handoff itself as evidence.
-- Retained pre-061 lease material identifies historical candidates; modern v2
-- completion clears that lease and is deliberately outside this repair.
create or replace function private.repair_legacy_completed_communication_handoffs() returns void
language plpgsql security definer set search_path='' as $$
declare migration_clock timestamptz:=clock_timestamp(); candidate record;
begin
  for candidate in
    select job.id job_id,job.organization_id,job.message_id,job.lease_owner,job.lease_token,
      job.lease_generation,job.lease_expires_at,
      job.provider_submission_started_at started_at,job.provider_idempotency_key,
      job.business_idempotency_key,job.completed_at,job.created_at job_created_at,
      message.created_at message_created_at,message.state message_state,
      message.provider_message_id message_provider_message_id,
      message.submitted_at message_submitted_at,
      handoff.send_attempt_token,handoff.organization_id handoff_organization_id,
      handoff.message_id handoff_message_id,
      handoff.lease_token handoff_lease_token,handoff.lease_generation handoff_lease_generation,
      handoff.started_at handoff_started_at,
      handoff.provider_idempotency_key handoff_provider_idempotency_key,
      handoff.attempt_state handoff_attempt_state,
      handoff.resolved_at handoff_resolved_at,
      handoff.provider_message_id handoff_provider_message_id,
      (select count(*) from public.outbox_provider_handoffs counted
        where counted.job_id=job.id) handoff_count,
      (select coalesce(jsonb_agg(jsonb_build_object(
          'organization_id',evidence.organization_id,
          'message_id',evidence.message_id,
          'lease_token',evidence.lease_token,
          'lease_generation',evidence.lease_generation,
          'started_at',evidence.started_at,
          'provider_idempotency_key',evidence.provider_idempotency_key,
          'send_attempt_token',evidence.send_attempt_token,
          'attempt_state',evidence.attempt_state,
          'resolved_at',evidence.resolved_at,
          'provider_message_id',evidence.provider_message_id
        ) order by evidence.started_at,evidence.send_attempt_token),'[]'::jsonb)
        from public.outbox_provider_handoffs evidence where evidence.job_id=job.id
      ) handoff_evidence
    from public.outbox_jobs job
    join public.communication_messages message
      on message.organization_id=job.organization_id and message.id=job.message_id
    left join lateral (
      select * from public.outbox_provider_handoffs selected
      where selected.job_id=job.id order by selected.started_at,selected.send_attempt_token limit 1
    ) handoff on true
    where job.status='completed' and job.provider_submission_started_at is not null
      and job.lease_token is not null
  loop
    if candidate.message_state='submitted'
      and private.is_canonical_provider_message_id(candidate.message_provider_message_id)
      and candidate.message_submitted_at is not null
      and candidate.lease_owner is not null and candidate.lease_token is not null
      and candidate.lease_generation>0 and candidate.lease_expires_at is not null
      and candidate.started_at>=candidate.job_created_at
      and candidate.started_at>=candidate.message_created_at
      and candidate.started_at<=candidate.lease_expires_at
      and candidate.started_at<=candidate.completed_at
      and candidate.started_at<=candidate.message_submitted_at
      and candidate.completed_at<=candidate.message_submitted_at
      and candidate.completed_at<=migration_clock
      and candidate.message_submitted_at<=migration_clock
      and candidate.provider_idempotency_key='communication:'||candidate.message_id::text
      and candidate.business_idempotency_key=(select business_idempotency_key
        from public.communication_messages where id=candidate.message_id)
      and candidate.handoff_count in (0,1)
      and (candidate.handoff_count=0 or (
        candidate.handoff_organization_id=candidate.organization_id
        and candidate.handoff_message_id=candidate.message_id
        and candidate.handoff_lease_token=candidate.lease_token
        and candidate.handoff_lease_generation=candidate.lease_generation
        and candidate.handoff_started_at=candidate.started_at
        and candidate.handoff_provider_idempotency_key=candidate.provider_idempotency_key
        and (
          candidate.handoff_attempt_state='delivery_uncertain'
          or (candidate.handoff_attempt_state='completed'
            and candidate.handoff_provider_message_id=candidate.message_provider_message_id
            and candidate.handoff_resolved_at=candidate.completed_at)
        )
      ))
    then
      if candidate.handoff_count=0 then
        insert into public.outbox_provider_handoffs(
          organization_id,job_id,message_id,lease_token,lease_generation,started_at,
          provider_idempotency_key,attempt_state,resolved_at,provider_message_id
        ) values(candidate.organization_id,candidate.job_id,candidate.message_id,
          candidate.lease_token,candidate.lease_generation,candidate.started_at,
          candidate.provider_idempotency_key,'completed',candidate.completed_at,
          candidate.message_provider_message_id);
      elsif candidate.handoff_attempt_state='delivery_uncertain' then
        update public.outbox_provider_handoffs
        set attempt_state='completed',resolved_at=candidate.completed_at,
          provider_message_id=candidate.message_provider_message_id
        where send_attempt_token=candidate.send_attempt_token;
      end if;
    else
      update public.outbox_jobs set
        legacy_completion_evidence=jsonb_strip_nulls(jsonb_build_object(
          'job_completed_at',candidate.completed_at,
          'message_provider_message_id',candidate.message_provider_message_id,
          'message_submitted_at',candidate.message_submitted_at,
          'handoff_provider_message_id',candidate.handoff_provider_message_id,
          'handoff_resolved_at',candidate.handoff_resolved_at,
          'handoff_attempt_state',candidate.handoff_attempt_state,
          'handoff_organization_id',candidate.handoff_organization_id,
          'handoff_message_id',candidate.handoff_message_id,
          'handoff_lease_token',candidate.handoff_lease_token,
          'handoff_lease_generation',candidate.handoff_lease_generation,
          'handoff_started_at',candidate.handoff_started_at,
          'handoff_provider_idempotency_key',candidate.handoff_provider_idempotency_key,
          'handoffs',candidate.handoff_evidence
        )),
        status='needs_attention',completed_at=null,dead_lettered_at=null,
        delivery_uncertain_at=coalesce(delivery_uncertain_at,migration_clock),
        delivery_uncertain_reason='legacy_completed_lineage_invalid',
        last_error_code='legacy_completed_lineage_invalid',
        lease_owner=null,lease_token=null,lease_expires_at=null
      where id=candidate.job_id;
      update public.outbox_provider_handoffs
      set attempt_state='delivery_uncertain',resolved_at=coalesce(resolved_at,migration_clock),
        provider_message_id=null
      where job_id=candidate.job_id and attempt_state in ('authorized','completed');
      update public.communication_messages
      set state=case when provider_message_id is null then 'delivery_uncertain' else state end,
        attention_required_at=coalesce(attention_required_at,migration_clock),cancellation_reason=null
      where id=candidate.message_id;
    end if;
  end loop;
end $$;

select private.repair_legacy_completed_communication_handoffs();

revoke all on function private.repair_legacy_completed_communication_handoffs(),
  private.is_canonical_provider_message_id(text)
from public,anon,authenticated,service_role;
