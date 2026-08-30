-- Network failures after a provider request is constructed are not proof of
-- rejection. Preserve that ambiguity on the exact send-attempt capability so
-- the automatic worker cannot resend it.
create function public.record_outbox_job_delivery_uncertain_v2(
  p_job_id uuid,p_lease_token uuid,p_lease_generation bigint,p_send_attempt_token uuid
) returns text language plpgsql security definer set search_path='' as $$
declare seed record; target public.outbox_jobs%rowtype; attempt public.outbox_provider_handoffs%rowtype;
begin
  if auth.role()<>'service_role' then raise exception 'forbidden' using errcode='42501'; end if;
  select message_id into seed from public.outbox_jobs where id=p_job_id;
  if not found then return 'not_found'; end if;
  perform private.lock_communication_primary_source(seed.message_id);
  perform 1 from public.communication_messages where id=seed.message_id for update;
  select * into target from public.outbox_jobs where id=p_job_id for update;
  select * into attempt from public.outbox_provider_handoffs
  where job_id=p_job_id and lease_token=p_lease_token and lease_generation=p_lease_generation
    and send_attempt_token=p_send_attempt_token for update;
  if not found then return 'attempt_conflict'; end if;
  if attempt.attempt_state='delivery_uncertain' and target.status='needs_attention'
    and target.delivery_uncertain_reason='delivery_uncertain' then return 'replayed'; end if;
  if attempt.attempt_state<>'authorized' then return 'attempt_conflict'; end if;
  if target.status not in ('leased','pending','needs_attention') then return 'terminal_conflict'; end if;
  update public.outbox_provider_handoffs
  set attempt_state='delivery_uncertain',resolved_at=clock_timestamp()
  where send_attempt_token=p_send_attempt_token and attempt_state='authorized';
  perform private.mark_outbox_delivery_uncertain(p_job_id,'delivery_uncertain');
  perform 1 from public.outbox_jobs where id=p_job_id and status='needs_attention'
    and delivery_uncertain_reason='delivery_uncertain';
  if not found then raise exception 'uncertainty transition failed' using errcode='55000'; end if;
  return 'needs_attention';
end $$;

revoke all on function public.record_outbox_job_delivery_uncertain_v2(uuid,uuid,bigint,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.record_outbox_job_delivery_uncertain_v2(uuid,uuid,bigint,uuid)
  to service_role;

-- Permit only two evidence-correcting historical transitions in addition to
-- the normal authorized-attempt resolution: a provable legacy completion and
-- a fail-closed correction of an invalid legacy completion.
create or replace function private.guard_outbox_handoff_insert() returns trigger
language plpgsql set search_path='' as $$
declare target public.outbox_jobs%rowtype; message public.communication_messages%rowtype;
begin
  if tg_op='UPDATE' then
    if new.organization_id is distinct from old.organization_id
      or new.job_id is distinct from old.job_id or new.message_id is distinct from old.message_id
      or new.lease_token is distinct from old.lease_token
      or new.lease_generation is distinct from old.lease_generation
      or new.provider_idempotency_key is distinct from old.provider_idempotency_key
      or new.send_attempt_token is distinct from old.send_attempt_token
      or new.started_at is distinct from old.started_at
    then raise exception 'provider attempt lineage is append-only' using errcode='55000'; end if;
    if old.attempt_state='authorized' and new.attempt_state<>'authorized' then return new; end if;
    select * into target from public.outbox_jobs where id=old.job_id;
    select * into message from public.communication_messages where id=old.message_id;
    if old.attempt_state='delivery_uncertain' and new.attempt_state='completed'
      and target.status='completed' and message.state='submitted'
      and new.provider_message_id=message.provider_message_id
      and new.resolved_at=target.completed_at
      and old.lease_token=target.lease_token and old.lease_generation=target.lease_generation
      and old.started_at=target.provider_submission_started_at
      and old.provider_idempotency_key=target.provider_idempotency_key
    then return new; end if;
    if old.attempt_state='completed' and new.attempt_state='delivery_uncertain'
      and target.status='needs_attention'
      and target.delivery_uncertain_reason='legacy_completed_lineage_invalid'
      and new.provider_message_id is null
    then return new; end if;
    raise exception 'provider attempt lineage is append-only' using errcode='55000';
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

create function private.repair_legacy_completed_communication_handoffs() returns void
language plpgsql security definer set search_path='' as $$
declare migration_clock timestamptz:=clock_timestamp(); candidate record;
begin
  for candidate in
    select job.id job_id,job.organization_id,job.message_id,job.lease_token,
      job.lease_generation,job.provider_submission_started_at started_at,
      job.provider_idempotency_key,job.completed_at,message.provider_message_id,
      coalesce((message.state='submitted' and message.provider_message_id is not null
        and message.provider_message_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        and message.submitted_at is not null and job.lease_owner is not null
        and job.lease_token is not null and job.lease_generation>0 and job.lease_expires_at is not null
        and job.provider_submission_started_at>=job.created_at
        and job.provider_submission_started_at>=message.created_at
        and job.provider_submission_started_at<=job.lease_expires_at
        and job.provider_submission_started_at<=job.completed_at
        and job.provider_submission_started_at<=message.submitted_at
        and job.completed_at<=message.submitted_at
        and job.completed_at<=migration_clock and message.submitted_at<=migration_clock
        and job.provider_idempotency_key='communication:'||message.id::text
        and job.business_idempotency_key=message.business_idempotency_key
        and not exists(select 1 from public.outbox_provider_handoffs handoff
          where handoff.job_id=job.id and (handoff.message_id<>job.message_id
            or handoff.lease_token<>job.lease_token or handoff.lease_generation<>job.lease_generation
            or handoff.started_at<>job.provider_submission_started_at
            or handoff.provider_idempotency_key<>job.provider_idempotency_key
            or handoff.attempt_state not in ('delivery_uncertain','completed')))),false) valid_lineage
    from public.outbox_jobs job join public.communication_messages message
      on message.organization_id=job.organization_id and message.id=job.message_id
    where job.status='completed' and job.provider_submission_started_at is not null
      and (job.lease_token is not null or not exists(
        select 1 from public.outbox_provider_handoffs completed_handoff
        where completed_handoff.job_id=job.id and completed_handoff.message_id=job.message_id
          and completed_handoff.provider_idempotency_key=job.provider_idempotency_key
          and completed_handoff.attempt_state='completed'
          and completed_handoff.provider_message_id=message.provider_message_id))
  loop
    if candidate.valid_lineage then
      update public.outbox_provider_handoffs
      set attempt_state='completed',resolved_at=candidate.completed_at,
        provider_message_id=candidate.provider_message_id
      where job_id=candidate.job_id and message_id=candidate.message_id
        and lease_token=candidate.lease_token and lease_generation=candidate.lease_generation
        and started_at=candidate.started_at
        and provider_idempotency_key=candidate.provider_idempotency_key
        and attempt_state='delivery_uncertain';
      if not exists(select 1 from public.outbox_provider_handoffs where job_id=candidate.job_id) then
        insert into public.outbox_provider_handoffs(
          organization_id,job_id,message_id,lease_token,lease_generation,started_at,
          provider_idempotency_key,attempt_state,resolved_at,provider_message_id
        ) values(candidate.organization_id,candidate.job_id,candidate.message_id,candidate.lease_token,
          candidate.lease_generation,candidate.started_at,candidate.provider_idempotency_key,
          'completed',candidate.completed_at,candidate.provider_message_id);
      end if;
    else
      update public.outbox_jobs set status='needs_attention',completed_at=null,dead_lettered_at=null,
        delivery_uncertain_at=coalesce(delivery_uncertain_at,migration_clock),
        delivery_uncertain_reason='legacy_completed_lineage_invalid',
        last_error_code='legacy_completed_lineage_invalid',
        lease_owner=null,lease_token=null,lease_expires_at=null where id=candidate.job_id;
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
  private.guard_outbox_handoff_insert()
from public,anon,authenticated,service_role;
