begin;
select plan(27);

select has_function('public','record_outbox_job_delivery_uncertain_v2',array['uuid','uuid','bigint','uuid'],
  'transport ambiguity has a dedicated exact-attempt transition');
select ok(has_function_privilege('service_role',
  'public.record_outbox_job_delivery_uncertain_v2(uuid,uuid,bigint,uuid)','execute'),
  'service worker may record exact transport ambiguity');
select ok(not has_function_privilege('authenticated',
  'public.record_outbox_job_delivery_uncertain_v2(uuid,uuid,bigint,uuid)','execute'),
  'clients cannot resolve provider attempt state');

insert into public.organizations(id,name,slug)
values('d4000000-0000-4000-8000-000000000001','Transport Repair Test','transport-repair-test');

insert into public.communication_messages(
  id,organization_id,source_kind,source_id,message_kind,notice_class,business_idempotency_key,
  request_digest,recipient_snapshot,content_snapshot,source_binding_version
) values(
  'd4000000-0000-4000-8000-000000000002','d4000000-0000-4000-8000-000000000001',
  'registration','d4000000-0000-4000-8000-000000000003','registration_reminder','optional',
  'task22:uncertain:0001',repeat('a',64),'{"email":"private@example.com"}',
  '{"subject":"Subject","text":"Body"}',0
);
insert into public.outbox_jobs(
  id,organization_id,message_id,business_idempotency_key,provider_idempotency_key,status,
  attempt_count,lease_owner,lease_token,lease_generation,lease_expires_at,provider_submission_started_at
) values(
  'd4000000-0000-4000-8000-000000000004','d4000000-0000-4000-8000-000000000001',
  'd4000000-0000-4000-8000-000000000002','task22:uncertain:0001',
  'communication:d4000000-0000-4000-8000-000000000002','leased',1,'worker-uncertain',
  'd4000000-0000-4000-8000-000000000005',1,clock_timestamp()+interval '90 seconds',clock_timestamp()
);
insert into public.outbox_provider_handoffs(
  organization_id,job_id,message_id,lease_token,lease_generation,provider_idempotency_key,
  send_attempt_token,started_at,attempt_state
) values(
  'd4000000-0000-4000-8000-000000000001','d4000000-0000-4000-8000-000000000004',
  'd4000000-0000-4000-8000-000000000002','d4000000-0000-4000-8000-000000000005',1,
  'communication:d4000000-0000-4000-8000-000000000002',
  'd4000000-0000-4000-8000-000000000006',clock_timestamp(),'authorized'
);

set local role service_role;
select is(public.record_outbox_job_delivery_uncertain_v2(
  'd4000000-0000-4000-8000-000000000004','d4000000-0000-4000-8000-000000000005',1,
  'd4000000-0000-4000-8000-000000000099'),'attempt_conflict',
  'wrong attempt capability cannot create uncertainty');
reset role;
select is((select attempt_state from public.outbox_provider_handoffs
  where job_id='d4000000-0000-4000-8000-000000000004'),'authorized',
  'wrong capability leaves provider attempt authorized');

set local role service_role;
select is(public.record_outbox_job_delivery_uncertain_v2(
  'd4000000-0000-4000-8000-000000000004','d4000000-0000-4000-8000-000000000005',1,
  'd4000000-0000-4000-8000-000000000006'),'needs_attention',
  'exact attempt records transport ambiguity without retry');
select is(public.record_outbox_job_delivery_uncertain_v2(
  'd4000000-0000-4000-8000-000000000004','d4000000-0000-4000-8000-000000000005',1,
  'd4000000-0000-4000-8000-000000000006'),'replayed',
  'exact uncertainty transition is replay safe');
reset role;
select is((select attempt_state from public.outbox_provider_handoffs
  where job_id='d4000000-0000-4000-8000-000000000004'),'delivery_uncertain',
  'attempt preserves delivery uncertainty');
select is((select status from public.outbox_jobs
  where id='d4000000-0000-4000-8000-000000000004'),'needs_attention',
  'ambiguous transport cannot return to the retry queue');
select is((select state from public.communication_messages
  where id='d4000000-0000-4000-8000-000000000002'),'delivery_uncertain',
  'message exposes attention-required delivery truth');
select is((select delivery_uncertain_reason from public.outbox_jobs
  where id='d4000000-0000-4000-8000-000000000004'),'delivery_uncertain',
  'privacy-safe transport reason is durable');

-- Rehearse the post-061 shape: one completed row was generically backfilled
-- as uncertain, another has no handoff, and malformed terminal variants retain
-- their original message evidence while failing closed.
insert into public.communication_messages(
  id,organization_id,source_kind,source_id,message_kind,notice_class,business_idempotency_key,
  request_digest,recipient_snapshot,content_snapshot,state,provider_message_id,submitted_at,source_binding_version,created_at
)
select id,'d4000000-0000-4000-8000-000000000001','registration',gen_random_uuid(),
  'registration_reminder','optional',business_key,repeat('b',64),'{"email":"private@example.com"}',
  '{"subject":"Subject","text":"Body"}',message_state,provider_id,submitted_at,0,'2026-08-29 12:00:00+00'
from (values
  ('d4000000-0000-4000-8000-000000000010'::uuid,'task22:legacy:valid1','submitted','d4000000-0000-4000-8000-000000000110','2026-08-29 12:00:03+00'::timestamptz),
  ('d4000000-0000-4000-8000-000000000020'::uuid,'task22:legacy:valid2','submitted','d4000000-0000-4000-8000-000000000120','2026-08-29 12:00:03+00'::timestamptz),
  ('d4000000-0000-4000-8000-000000000030'::uuid,'task22:legacy:missing','queued',null,null),
  ('d4000000-0000-4000-8000-000000000040'::uuid,'task22:legacy:badid1','submitted','bad-provider-id','2026-08-29 12:00:03+00'::timestamptz),
  ('d4000000-0000-4000-8000-000000000050'::uuid,'task22:legacy:timing','submitted','d4000000-0000-4000-8000-000000000150','2026-08-29 12:00:03+00'::timestamptz),
  ('d4000000-0000-4000-8000-000000000060'::uuid,'task22:legacy:binding','submitted','d4000000-0000-4000-8000-000000000160','2026-08-29 12:00:03+00'::timestamptz),
  ('d4000000-0000-4000-8000-000000000070'::uuid,'task22:modern:complete','submitted','d4000000-0000-4000-8000-000000000170','2026-08-29 12:00:03+00'::timestamptz)
) fixture(id,business_key,message_state,provider_id,submitted_at);

insert into public.outbox_jobs(
  id,organization_id,message_id,business_idempotency_key,provider_idempotency_key,status,
  attempt_count,lease_owner,lease_token,lease_generation,lease_expires_at,
  provider_submission_started_at,completed_at,created_at
)
select job_id,'d4000000-0000-4000-8000-000000000001',message_id,job_business_key,
  'communication:'||message_id::text,'completed',1,'legacy-worker',lease_token,1,lease_expiry,
  provider_started,'2026-08-29 12:00:03+00','2026-08-29 12:00:00+00'
from (values
  ('d4000000-0000-4000-8000-000000000011'::uuid,'d4000000-0000-4000-8000-000000000010'::uuid,'task22:legacy:valid1','d4000000-0000-4000-8000-000000000111'::uuid,'2026-08-29 12:01:00+00'::timestamptz,'2026-08-29 12:00:02+00'::timestamptz),
  ('d4000000-0000-4000-8000-000000000021'::uuid,'d4000000-0000-4000-8000-000000000020'::uuid,'task22:legacy:valid2','d4000000-0000-4000-8000-000000000121'::uuid,'2026-08-29 12:01:00+00'::timestamptz,'2026-08-29 12:00:02+00'::timestamptz),
  ('d4000000-0000-4000-8000-000000000031'::uuid,'d4000000-0000-4000-8000-000000000030'::uuid,'task22:legacy:missing','d4000000-0000-4000-8000-000000000131'::uuid,'2026-08-29 12:01:00+00'::timestamptz,'2026-08-29 12:00:02+00'::timestamptz),
  ('d4000000-0000-4000-8000-000000000041'::uuid,'d4000000-0000-4000-8000-000000000040'::uuid,'task22:legacy:badid1','d4000000-0000-4000-8000-000000000141'::uuid,'2026-08-29 12:01:00+00'::timestamptz,'2026-08-29 12:00:02+00'::timestamptz),
  ('d4000000-0000-4000-8000-000000000051'::uuid,'d4000000-0000-4000-8000-000000000050'::uuid,'task22:legacy:timing','d4000000-0000-4000-8000-000000000151'::uuid,'2026-08-29 12:00:01+00'::timestamptz,'2026-08-29 12:00:02+00'::timestamptz),
  ('d4000000-0000-4000-8000-000000000061'::uuid,'d4000000-0000-4000-8000-000000000060'::uuid,'task22:legacy:different','d4000000-0000-4000-8000-000000000161'::uuid,'2026-08-29 12:01:00+00'::timestamptz,'2026-08-29 12:00:02+00'::timestamptz),
  ('d4000000-0000-4000-8000-000000000071'::uuid,'d4000000-0000-4000-8000-000000000070'::uuid,'task22:modern:complete','d4000000-0000-4000-8000-000000000171'::uuid,'2026-08-29 12:01:00+00'::timestamptz,'2026-08-29 12:00:02+00'::timestamptz)
) fixture(job_id,message_id,job_business_key,lease_token,lease_expiry,provider_started);

insert into public.outbox_provider_handoffs(
  organization_id,job_id,message_id,lease_token,lease_generation,started_at,
  provider_idempotency_key,send_attempt_token,attempt_state,resolved_at,provider_message_id
) values(
  'd4000000-0000-4000-8000-000000000001','d4000000-0000-4000-8000-000000000011',
  'd4000000-0000-4000-8000-000000000010','d4000000-0000-4000-8000-000000000111',1,
  '2026-08-29 12:00:02+00','communication:d4000000-0000-4000-8000-000000000010',
  'd4000000-0000-4000-8000-000000000112','delivery_uncertain','2026-08-29 12:00:04+00',null
),(
  'd4000000-0000-4000-8000-000000000001','d4000000-0000-4000-8000-000000000071',
  'd4000000-0000-4000-8000-000000000070','d4000000-0000-4000-8000-000000000171',1,
  '2026-08-29 12:00:02+00','communication:d4000000-0000-4000-8000-000000000070',
  'd4000000-0000-4000-8000-000000000172','completed','2026-08-29 12:00:02.500+00',
  'd4000000-0000-4000-8000-000000000170'
);
update public.outbox_jobs set lease_owner=null,lease_token=null,lease_expires_at=null
where id='d4000000-0000-4000-8000-000000000071';

select lives_ok('select private.repair_legacy_completed_communication_handoffs()',
  'legacy completion repair executes');
select lives_ok('select private.repair_legacy_completed_communication_handoffs()',
  'legacy completion repair is idempotent');
select is((select attempt_state from public.outbox_provider_handoffs
  where job_id='d4000000-0000-4000-8000-000000000011'),'completed',
  '061 uncertain handoff is corrected when exact completion proof exists');
select is((select provider_message_id from public.outbox_provider_handoffs
  where job_id='d4000000-0000-4000-8000-000000000011'),
  'd4000000-0000-4000-8000-000000000110','corrected handoff retains exact provider ID');
select is((select resolved_at from public.outbox_provider_handoffs
  where job_id='d4000000-0000-4000-8000-000000000011'),
  '2026-08-29 12:00:03+00'::timestamptz,'corrected handoff uses exact legacy completion time');
select is((select attempt_state from public.outbox_provider_handoffs
  where job_id='d4000000-0000-4000-8000-000000000021'),'completed',
  'missing valid legacy handoff is backfilled as completed');
select is((select provider_message_id from public.outbox_provider_handoffs
  where job_id='d4000000-0000-4000-8000-000000000021'),
  'd4000000-0000-4000-8000-000000000120','backfill retains exact provider ID');
select is((select count(*) from public.outbox_provider_handoffs
  where job_id in ('d4000000-0000-4000-8000-000000000011','d4000000-0000-4000-8000-000000000021')),
  2::bigint,'repeated repair creates no duplicate handoffs');
select is((select count(*) from public.outbox_jobs where id in(
  'd4000000-0000-4000-8000-000000000031','d4000000-0000-4000-8000-000000000041',
  'd4000000-0000-4000-8000-000000000051','d4000000-0000-4000-8000-000000000061')
  and status='needs_attention' and delivery_uncertain_reason='legacy_completed_lineage_invalid'),4::bigint,
  'all malformed completed variants fail closed with an explicit lineage reason');
select is((select provider_message_id from public.communication_messages
  where id='d4000000-0000-4000-8000-000000000040'),'bad-provider-id',
  'malformed provider evidence is preserved for investigation');
select is((select provider_message_id from public.communication_messages
  where id='d4000000-0000-4000-8000-000000000050'),
  'd4000000-0000-4000-8000-000000000150','temporal-invalid provider evidence is preserved');
select is((select count(*) from public.outbox_provider_handoffs where job_id in(
  'd4000000-0000-4000-8000-000000000031','d4000000-0000-4000-8000-000000000041',
  'd4000000-0000-4000-8000-000000000051','d4000000-0000-4000-8000-000000000061')
  and attempt_state='completed'),0::bigint,'malformed lineage never gains completion authority');
select is((select status from public.outbox_jobs
  where id='d4000000-0000-4000-8000-000000000071'),'completed',
  'post-061 completed jobs with exact completed handoffs are not legacy repair candidates');
select is((select attempt_state from public.outbox_provider_handoffs
  where job_id='d4000000-0000-4000-8000-000000000071'),'completed',
  'post-061 completion truth is not downgraded');
select is((select provider_message_id from public.outbox_provider_handoffs
  where job_id='d4000000-0000-4000-8000-000000000071'),
  'd4000000-0000-4000-8000-000000000170','post-061 provider evidence remains exact');
select ok(not has_function_privilege('service_role',
  'private.repair_legacy_completed_communication_handoffs()','execute'),
  'runtime service cannot invoke historical repair');

select * from finish();
rollback;
