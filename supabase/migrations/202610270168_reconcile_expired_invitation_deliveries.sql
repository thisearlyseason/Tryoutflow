-- Bounded operator repair, not a retry API. Two rejected staff invitations
-- expired on October 7. The third email is confirmed delivered in Resend:
-- https://resend.com/emails/01a0f01d-7021-724c-a281-c2dc60739d68
-- Its message_id tag is 354f0b25-b67b-4cd0-b954-6a65531fcf52 and its
-- successful SMTP response records 2026-09-30 02:20:57 UTC.
-- No email, invitation, membership, trial, or entitlement is created here.
create function private.reconcile_20260930_invitation_deliveries()
returns integer language plpgsql security definer set search_path='' as $$
declare
  target record;
  job public.outbox_jobs%rowtype;
  message public.communication_messages%rowtype;
  invitation public.organization_invitations%rowtype;
  repaired integer:=0;
  target_count integer;
  prior_count integer;
begin
  select count(*) into target_count from public.outbox_jobs where id in
    ('1b5e5294-032c-42cc-a059-bf01b2298960','41c8ef42-2d5d-4c95-bdfc-8eda0079cc3c',
     '9bb12d83-2299-4dd0-b3ff-67de55e2a0f3');
  -- Fresh/local databases have no historical production records.
  if target_count=0 then return 0; end if;
  if target_count<>3 then raise exception 'historical delivery target set changed' using errcode='23514'; end if;

  for target in select * from (values
    ('1b5e5294-032c-42cc-a059-bf01b2298960'::uuid,'40621748-6550-4655-a51e-37553654c7f1'::uuid,
     '328edb76-3ee2-42f3-bfde-e86ed8878c97'::uuid,'2026-10-07 02:01:26.226+00'::timestamptz,false),
    ('41c8ef42-2d5d-4c95-bdfc-8eda0079cc3c'::uuid,'bb767b8f-60cb-4f32-8c26-5d203ce75956'::uuid,
     '9e4769bf-226c-47a4-94d1-09821d2c745b'::uuid,'2026-10-07 02:16:37.891+00'::timestamptz,false),
    ('9bb12d83-2299-4dd0-b3ff-67de55e2a0f3'::uuid,'354f0b25-b67b-4cd0-b954-6a65531fcf52'::uuid,
     '8489a3a3-7070-4af0-9973-5e7133acee45'::uuid,'2026-10-07 02:20:44.481+00'::timestamptz,true)
  ) as targets(job_id,message_id,invitation_id,expires_at,delivered)
  loop
    perform private.lock_communication_primary_source(target.message_id);
    select * into message from public.communication_messages where id=target.message_id for update;
    select * into job from public.outbox_jobs where id=target.job_id for update;
    select * into invitation from public.organization_invitations where id=target.invitation_id for update;
    if job.message_id is distinct from target.message_id
      or message.source_id is distinct from target.invitation_id
      or message.source_kind is distinct from 'invitation'
      or message.message_kind is distinct from 'member_invitation'
      or job.organization_id is distinct from message.organization_id
      or invitation.organization_id is distinct from message.organization_id
      or invitation.expires_at is distinct from target.expires_at
      or invitation.expires_at>=clock_timestamp() or invitation.accepted_at is not null
      or message.source_invitation_token_digest is distinct from invitation.token_digest
      or message.source_authorizing_user_id is distinct from invitation.created_by_user_id
      or message.recipient_snapshot->>'email' is distinct from invitation.email::text
    then raise exception 'historical invitation identity changed' using errcode='23514'; end if;

    select count(*) into prior_count from public.audit_logs
    where entity_type='outbox_job' and entity_id=target.job_id
      and action='communication.historical_delivery_reconciled'
      and details->>'repair'='202610270168';
    if prior_count=1 then
      if (target.delivered and job.status='completed' and message.state='delivered'
          and message.provider_message_id='01a0f01d-7021-724c-a281-c2dc60739d68')
        or (not target.delivered and job.status='cancelled' and message.state='failed'
          and message.provider_message_id is null)
      then continue; end if;
      raise exception 'historical reconciliation replay conflict' using errcode='23514';
    end if;
    if prior_count<>0 or job.attempt_count<>1 or message.provider_message_id is not null
      or job.provider_idempotency_key is distinct from 'communication:'||message.id::text
      or (select count(*) from public.outbox_provider_handoffs where job_id=job.id)<>1
      or not exists(select 1 from public.outbox_provider_handoffs h
        where h.job_id=job.id and h.message_id=message.id and h.organization_id=job.organization_id
          and h.provider_idempotency_key=job.provider_idempotency_key and h.provider_message_id is null
          and h.attempt_state=case when target.delivered then 'delivery_uncertain' else 'provider_failed' end)
      or (target.delivered and (job.status<>'needs_attention' or message.state<>'delivery_uncertain'
          or job.last_error_code is distinct from 'delivery_uncertain'))
      or (not target.delivered and (job.status<>'dead_letter' or message.state<>'failed'
          or job.last_error_code is distinct from 'provider_rejected'))
    then raise exception 'historical delivery evidence changed' using errcode='23514'; end if;

    insert into public.audit_logs(organization_id,actor_user_id,action,entity_type,entity_id,details)
    values(job.organization_id,null,'communication.historical_delivery_reconciled','outbox_job',job.id,
      jsonb_build_object('repair','202610270168','message_id',message.id,
        'previous_job_status',job.status,'previous_message_state',message.state,
        'previous_error_code',job.last_error_code,'previous_uncertainty_reason',job.delivery_uncertain_reason,
        'resolution',case when target.delivered then 'provider_delivery_verified' else 'expired_invitation_rejection_closed' end,
        'evidence',case when target.delivered
          then 'https://resend.com/emails/01a0f01d-7021-724c-a281-c2dc60739d68'
          else 'retained_provider_failed_handoff' end));

    if target.delivered then
      update public.communication_messages set state='delivered',
        provider_message_id='01a0f01d-7021-724c-a281-c2dc60739d68',
        submitted_at=coalesce(submitted_at,'2026-09-30 02:20:57+00'),
        delivery_state_at=greatest(coalesce(delivery_state_at,'-infinity'::timestamptz),'2026-09-30 02:20:57+00'::timestamptz),
        attention_required_at=null where id=message.id;
      update public.outbox_jobs set status='completed',completed_at=clock_timestamp(),
        dead_lettered_at=null,delivery_uncertain_at=null,delivery_uncertain_reason=null,last_error_code=null,
        lease_owner=null,lease_token=null,lease_expires_at=null where id=job.id;
      -- Keep the original uncertain handoff immutable. This manual provider
      -- readback is an audit record, never a fabricated signed webhook event.
    else
      update public.outbox_jobs set status='cancelled',lease_owner=null,lease_token=null,
        lease_expires_at=null where id=job.id;
      -- Preserve message.state=failed, provider_rejected and provider_failed.
    end if;
    repaired:=repaired+1;
  end loop;
  return repaired;
end $$;
revoke all on function private.reconcile_20260930_invitation_deliveries()
  from public,anon,authenticated,service_role;
select private.reconcile_20260930_invitation_deliveries();
