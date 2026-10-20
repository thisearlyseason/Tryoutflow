begin;
select plan(14);

select has_column('public','outbox_jobs','delivery_uncertain_at','uncertain provider handoff is durable');
select has_column('public','outbox_jobs','delivery_uncertain_reason','uncertainty has a privacy-safe reason');
select col_has_check('public','outbox_jobs','status','job state is constrained');
select col_has_check('public','communication_messages','state','message state is constrained');

insert into public.organizations(id,name,slug)
values('00000000-0000-4000-8000-000000000000','Uncertainty Test','uncertainty-test');

select lives_ok($$insert into public.communication_messages(
    id,organization_id,source_kind,source_id,message_kind,notice_class,business_idempotency_key,
    request_digest,recipient_snapshot,content_snapshot,source_binding_version,source_registration_id,
    source_guardian_id,source_authorizing_user_id,state,attention_required_at
  ) values(
    'a1000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000000',
    'registration','a1000000-0000-4000-8000-000000000002','registration_reminder','optional',
    'task22:uncertain:message:0001',repeat('a',64),'{"email":"private@example.com"}',
    '{"subject":"Subject","text":"Body"}',1,'a1000000-0000-4000-8000-000000000002',
    'a1000000-0000-4000-8000-000000000003','a1000000-0000-4000-8000-000000000004',
    'delivery_uncertain',clock_timestamp()
  )$$,'message can state delivery uncertainty without asserting failure');

select lives_ok($$insert into public.outbox_jobs(
    id,organization_id,message_id,business_idempotency_key,provider_idempotency_key,status,
    attempt_count,lease_generation,provider_submission_started_at,delivery_uncertain_at,
    delivery_uncertain_reason,last_error_code
  ) values(
    'a1000000-0000-4000-8000-000000000005','00000000-0000-4000-8000-000000000000',
    'a1000000-0000-4000-8000-000000000001','task22:uncertain:message:0001',
    'communication:a1000000-0000-4000-8000-000000000001','needs_attention',5,1,
    clock_timestamp(),clock_timestamp(),'source_invalid_after_provider_handoff',
    'source_invalid_after_provider_handoff'
  )$$,'job can require attention after an uncertain provider handoff');

select is((select state from public.communication_messages where id='a1000000-0000-4000-8000-000000000001'),
  'delivery_uncertain','message truth is not cancelled or failed');
select is((select status from public.outbox_jobs where id='a1000000-0000-4000-8000-000000000005'),
  'needs_attention','job truth requires manual attention');
select ok((select provider_submission_started_at is not null from public.outbox_jobs where id='a1000000-0000-4000-8000-000000000005'),
  'provider-started marker is retained');
select ok((select delivery_uncertain_reason ~ '^[a-z][a-z0-9_]{2,63}$' from public.outbox_jobs where id='a1000000-0000-4000-8000-000000000005'),
  'uncertainty reason is a bounded code');
select ok(not has_function_privilege('authenticated','public.complete_outbox_job_v2(uuid,uuid,bigint,uuid,text)','execute'),
  'late completion remains service-only');
select ok(has_function_privilege('service_role','public.complete_outbox_job_v2(uuid,uuid,bigint,uuid,text)','execute'),
  'service can reconcile an exact provider handoff');
select ok(not has_table_privilege('service_role','public.outbox_provider_handoffs','insert'),
  'service cannot forge a provider handoff outside the authorization RPC');
select ok(not has_table_privilege('service_role','public.outbox_provider_handoffs','update'),
  'service cannot rewrite exact provider handoff evidence');

select * from finish();
rollback;
