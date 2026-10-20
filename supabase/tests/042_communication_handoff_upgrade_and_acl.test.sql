begin;
select plan(26);

select has_function('public','decline_outbox_job_send_v2',array['uuid','uuid','bigint','uuid','text'],
  'authorized but known-not-sent handoffs have an exact fenced release RPC');
select ok(has_function_privilege('service_role','public.decline_outbox_job_send_v2(uuid,uuid,bigint,uuid,text)','execute'),
  'service worker may release its exact known-not-sent handoff');
select ok(not has_function_privilege('authenticated','public.decline_outbox_job_send_v2(uuid,uuid,bigint,uuid,text)','execute'),
  'clients cannot release provider handoffs');

select ok(not has_table_privilege('service_role','public.communication_messages','insert'),'service cannot insert messages directly');
select ok(not has_table_privilege('service_role','public.communication_messages','update'),'service cannot update messages directly');
select ok(not has_table_privilege('service_role','public.communication_messages','delete'),'service cannot delete messages directly');
select ok(not has_table_privilege('service_role','public.communication_messages','truncate'),'service cannot truncate messages directly');
select ok(not has_table_privilege('service_role','public.communication_messages','references'),'service cannot add references to messages');
select ok(not has_table_privilege('service_role','public.communication_messages','trigger'),'service cannot create message triggers');
select ok(not has_table_privilege('service_role','public.communication_messages','maintain'),'service cannot maintain messages directly');

select ok(not has_table_privilege('service_role','public.outbox_jobs','insert'),'service cannot insert jobs directly');
select ok(not has_table_privilege('service_role','public.outbox_jobs','update'),'service cannot update jobs directly');
select ok(not has_table_privilege('service_role','public.outbox_jobs','delete'),'service cannot delete jobs directly');
select ok(not has_table_privilege('service_role','public.outbox_jobs','truncate'),'service cannot truncate jobs directly');
select ok(not has_table_privilege('service_role','public.outbox_jobs','references'),'service cannot add references to jobs');
select ok(not has_table_privilege('service_role','public.outbox_jobs','trigger'),'service cannot create job triggers');
select ok(not has_table_privilege('service_role','public.outbox_jobs','maintain'),'service cannot maintain jobs directly');

insert into public.organizations(id,name,slug)
values('b2000000-0000-4000-8000-000000000001','Handoff ACL Test','handoff-acl-test');
insert into public.communication_messages(
  id,organization_id,source_kind,source_id,message_kind,notice_class,business_idempotency_key,
  request_digest,recipient_snapshot,content_snapshot,source_binding_version
) values(
  'b2000000-0000-4000-8000-000000000002','b2000000-0000-4000-8000-000000000001',
  'registration','b2000000-0000-4000-8000-000000000003','registration_reminder','optional',
  'task22:decline:0001',repeat('a',64),'{"email":"private@example.com"}',
  '{"subject":"Subject","text":"Body"}',0
);
insert into public.outbox_jobs(
  id,organization_id,message_id,business_idempotency_key,provider_idempotency_key,status,
  attempt_count,lease_owner,lease_token,lease_generation,lease_expires_at,
  provider_submission_started_at
) values(
  'b2000000-0000-4000-8000-000000000004','b2000000-0000-4000-8000-000000000001',
  'b2000000-0000-4000-8000-000000000002','task22:decline:0001',
  'communication:b2000000-0000-4000-8000-000000000002','leased',1,'worker-decline',
  'b2000000-0000-4000-8000-000000000005',1,clock_timestamp()+interval '60 seconds',clock_timestamp()
);
insert into public.outbox_provider_handoffs(
  organization_id,job_id,message_id,lease_token,lease_generation,provider_idempotency_key,send_attempt_token
) values('b2000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000004',
  'b2000000-0000-4000-8000-000000000002','b2000000-0000-4000-8000-000000000005',1,
  'communication:b2000000-0000-4000-8000-000000000002','b2000000-0000-4000-8000-000000000006');

set local role service_role;
select is(public.decline_outbox_job_send_v2(
  'b2000000-0000-4000-8000-000000000004','b2000000-0000-4000-8000-000000000005',1,
  'b2000000-0000-4000-8000-000000000006',
  'provider_deadline_elapsed'
),'retry_scheduled','exact authorized handoff can be durably classified as known not sent');
reset role;
select is((select status from public.outbox_jobs where id='b2000000-0000-4000-8000-000000000004'),
  'pending','known-not-sent job is retryable');
select is((select last_error_code from public.outbox_jobs where id='b2000000-0000-4000-8000-000000000004'),
  'provider_deadline_elapsed','known-not-sent reason is durable');
select ok((select provider_submission_started_at is null from public.outbox_jobs where id='b2000000-0000-4000-8000-000000000004'),
  'decline clears the provider-start ambiguity marker');
select is((select count(*) from public.outbox_provider_handoffs where job_id='b2000000-0000-4000-8000-000000000004'),
  1::bigint,'decline retains its exact unsubmitted handoff lineage');
select ok((select lease_token is null and lease_owner is null and lease_expires_at is null
  from public.outbox_jobs where id='b2000000-0000-4000-8000-000000000004'),
  'decline releases the exact lease');
set local role service_role;
select is(public.decline_outbox_job_send_v2(
  'b2000000-0000-4000-8000-000000000004','b2000000-0000-4000-8000-000000000005',1,
  'b2000000-0000-4000-8000-000000000006',
  'provider_deadline_elapsed'
),'lease_conflict','stale decline cannot alter the rescheduled generation');
select throws_ok($$delete from public.outbox_jobs where id='b2000000-0000-4000-8000-000000000004'$$,
  '42501',null,'direct service job deletion cannot cascade handoff evidence');
select throws_ok($$update public.communication_messages set state='submitted' where id='b2000000-0000-4000-8000-000000000002'$$,
  '42501',null,'direct service message terminal-state manufacture is denied');
reset role;

select * from finish();
rollback;
