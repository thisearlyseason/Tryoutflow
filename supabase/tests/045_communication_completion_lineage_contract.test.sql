begin;
select plan(24);

select has_column('public','outbox_jobs','legacy_completion_evidence',
  'invalid historical completions retain their exact evidence');
select ok(private.is_canonical_provider_message_id('e5000000-0000-1000-8000-000000000001'),
  'database accepts canonical RFC variant version 1');
select ok(private.is_canonical_provider_message_id('e5000000-0000-5000-b000-000000000001'),
  'database accepts canonical RFC variant version 5');
select ok(not private.is_canonical_provider_message_id('00000000-0000-0000-0000-000000000000'),
  'database rejects nil UUID');
select ok(not private.is_canonical_provider_message_id('E5000000-0000-4000-8000-000000000001'),
  'database rejects uppercase UUID');
select ok(not private.is_canonical_provider_message_id('e5000000-0000-6000-8000-000000000001'),
  'database rejects version 6');
select ok(not private.is_canonical_provider_message_id('e5000000-0000-8000-8000-000000000001'),
  'database rejects version 8');
select ok(not private.is_canonical_provider_message_id('e5000000-0000-4000-7000-000000000001'),
  'database rejects non-RFC variant');
select ok(not has_function_privilege('service_role',
  'private.is_canonical_provider_message_id(text)','execute'),
  'provider identifier helper remains private to constrained database code');

insert into public.organizations(id,name,slug)
values('e5000000-0000-4000-8000-000000000001','Exact Completion Test','exact-completion-test');

insert into public.communication_messages(
  id,organization_id,source_kind,source_id,message_kind,notice_class,business_idempotency_key,
  request_digest,recipient_snapshot,content_snapshot,state,provider_message_id,submitted_at,
  source_binding_version,created_at
)
select message_id,'e5000000-0000-4000-8000-000000000001','registration',gen_random_uuid(),
  'registration_reminder','optional',business_key,repeat('e',64),
  '{"email":"private@example.com"}','{"subject":"Subject","text":"Body"}',
  message_state,provider_id,submitted_at,0,'2026-08-29 12:00:00+00'
from (values
  ('e5000000-0000-4000-8000-000000000010'::uuid,'task22:exact:valid','submitted','e5000000-0000-4000-8000-000000000110','2026-08-29 12:00:03+00'::timestamptz),
  ('e5000000-0000-4000-8000-000000000020'::uuid,'task22:exact:wrongid','submitted','e5000000-0000-4000-8000-000000000120','2026-08-29 12:00:03+00'::timestamptz),
  ('e5000000-0000-4000-8000-000000000030'::uuid,'task22:exact:wrongtime','submitted','e5000000-0000-4000-8000-000000000130','2026-08-29 12:00:03+00'::timestamptz),
  ('e5000000-0000-4000-8000-000000000040'::uuid,'task22:exact:uppercase','submitted','E5000000-0000-4000-8000-000000000140','2026-08-29 12:00:03+00'::timestamptz),
  ('e5000000-0000-4000-8000-000000000050'::uuid,'task22:exact:invalid','submitted','not-a-provider-id','2026-08-29 12:00:03+00'::timestamptz),
  ('e5000000-0000-4000-8000-000000000060'::uuid,'task22:exact:missing','queued',null,null),
  ('e5000000-0000-4000-8000-000000000070'::uuid,'task22:exact:modern','submitted','e5000000-0000-4000-8000-000000000170','2026-08-29 12:00:03+00'::timestamptz)
) fixture(message_id,business_key,message_state,provider_id,submitted_at);

insert into public.outbox_jobs(
  id,organization_id,message_id,business_idempotency_key,provider_idempotency_key,status,
  attempt_count,lease_owner,lease_token,lease_generation,lease_expires_at,
  provider_submission_started_at,completed_at,created_at
)
select job_id,'e5000000-0000-4000-8000-000000000001',message_id,business_key,
  'communication:'||message_id::text,'completed',1,'legacy-worker',lease_token,1,
  '2026-08-29 12:01:00+00','2026-08-29 12:00:02+00','2026-08-29 12:00:03+00',
  '2026-08-29 12:00:00+00'
from (values
  ('e5000000-0000-4000-8000-000000000011'::uuid,'e5000000-0000-4000-8000-000000000010'::uuid,'task22:exact:valid','e5000000-0000-4000-8000-000000000111'::uuid),
  ('e5000000-0000-4000-8000-000000000021'::uuid,'e5000000-0000-4000-8000-000000000020'::uuid,'task22:exact:wrongid','e5000000-0000-4000-8000-000000000121'::uuid),
  ('e5000000-0000-4000-8000-000000000031'::uuid,'e5000000-0000-4000-8000-000000000030'::uuid,'task22:exact:wrongtime','e5000000-0000-4000-8000-000000000131'::uuid),
  ('e5000000-0000-4000-8000-000000000041'::uuid,'e5000000-0000-4000-8000-000000000040'::uuid,'task22:exact:uppercase','e5000000-0000-4000-8000-000000000141'::uuid),
  ('e5000000-0000-4000-8000-000000000051'::uuid,'e5000000-0000-4000-8000-000000000050'::uuid,'task22:exact:invalid','e5000000-0000-4000-8000-000000000151'::uuid),
  ('e5000000-0000-4000-8000-000000000061'::uuid,'e5000000-0000-4000-8000-000000000060'::uuid,'task22:exact:missing','e5000000-0000-4000-8000-000000000161'::uuid),
  ('e5000000-0000-4000-8000-000000000071'::uuid,'e5000000-0000-4000-8000-000000000070'::uuid,'task22:exact:modern','e5000000-0000-4000-8000-000000000171'::uuid)
) fixture(job_id,message_id,business_key,lease_token);

insert into public.outbox_provider_handoffs(
  organization_id,job_id,message_id,lease_token,lease_generation,started_at,
  provider_idempotency_key,send_attempt_token,attempt_state,resolved_at,provider_message_id
)
select 'e5000000-0000-4000-8000-000000000001',job_id,message_id,lease_token,1,
  '2026-08-29 12:00:02+00','communication:'||message_id::text,attempt_token,'completed',
  resolved_at,provider_id
from (values
  ('e5000000-0000-4000-8000-000000000011'::uuid,'e5000000-0000-4000-8000-000000000010'::uuid,'e5000000-0000-4000-8000-000000000111'::uuid,'e5000000-0000-4000-8000-000000000112'::uuid,'2026-08-29 12:00:03+00'::timestamptz,'e5000000-0000-4000-8000-000000000110'),
  ('e5000000-0000-4000-8000-000000000021'::uuid,'e5000000-0000-4000-8000-000000000020'::uuid,'e5000000-0000-4000-8000-000000000121'::uuid,'e5000000-0000-4000-8000-000000000122'::uuid,'2026-08-29 12:00:03+00'::timestamptz,'e5000000-0000-4000-8000-000000000129'),
  ('e5000000-0000-4000-8000-000000000031'::uuid,'e5000000-0000-4000-8000-000000000030'::uuid,'e5000000-0000-4000-8000-000000000131'::uuid,'e5000000-0000-4000-8000-000000000132'::uuid,'2026-08-29 12:00:04+00'::timestamptz,'e5000000-0000-4000-8000-000000000130'),
  ('e5000000-0000-4000-8000-000000000071'::uuid,'e5000000-0000-4000-8000-000000000070'::uuid,'e5000000-0000-4000-8000-000000000171'::uuid,'e5000000-0000-4000-8000-000000000172'::uuid,'2026-08-29 12:00:02.5+00'::timestamptz,'e5000000-0000-4000-8000-000000000170')
) fixture(job_id,message_id,lease_token,attempt_token,resolved_at,provider_id);

update public.outbox_jobs set lease_owner=null,lease_token=null,lease_expires_at=null
where id='e5000000-0000-4000-8000-000000000071';

select lives_ok('select private.repair_legacy_completed_communication_handoffs()',
  'latest exact legacy repair executes');
select lives_ok('select private.repair_legacy_completed_communication_handoffs()',
  'latest exact legacy repair is idempotent');
select is((select status from public.outbox_jobs where id='e5000000-0000-4000-8000-000000000011'),
  'completed','exact legacy completion remains accepted');
select is((select count(*) from public.outbox_jobs where id in(
  'e5000000-0000-4000-8000-000000000021','e5000000-0000-4000-8000-000000000031',
  'e5000000-0000-4000-8000-000000000041','e5000000-0000-4000-8000-000000000051',
  'e5000000-0000-4000-8000-000000000061') and status='needs_attention'
  and delivery_uncertain_reason='legacy_completed_lineage_invalid'),5::bigint,
  'wrong, missing, uppercase, invalid, or timestamp-mismatched legacy completion fails closed');
select is((select attempt_state from public.outbox_provider_handoffs
  where job_id='e5000000-0000-4000-8000-000000000021'),'delivery_uncertain',
  'mismatched provider ID loses completion authority');
select is((select attempt_state from public.outbox_provider_handoffs
  where job_id='e5000000-0000-4000-8000-000000000031'),'delivery_uncertain',
  'mismatched resolution time loses completion authority');
select is((select legacy_completion_evidence->>'handoff_provider_message_id'
  from public.outbox_jobs where id='e5000000-0000-4000-8000-000000000021'),
  'e5000000-0000-4000-8000-000000000129','wrong handoff provider ID remains evidence');
select is((select legacy_completion_evidence->>'message_provider_message_id'
  from public.outbox_jobs where id='e5000000-0000-4000-8000-000000000021'),
  'e5000000-0000-4000-8000-000000000120','message provider ID remains evidence');
select is((select (legacy_completion_evidence->>'handoff_resolved_at')::timestamptz
  from public.outbox_jobs where id='e5000000-0000-4000-8000-000000000031'),
  '2026-08-29 12:00:04+00'::timestamptz,'wrong handoff completion time remains evidence');
select is((select (legacy_completion_evidence->>'job_completed_at')::timestamptz
  from public.outbox_jobs where id='e5000000-0000-4000-8000-000000000031'),
  '2026-08-29 12:00:03+00'::timestamptz,'job completion time remains evidence');
select is((select provider_message_id from public.communication_messages
  where id='e5000000-0000-4000-8000-000000000040'),
  'E5000000-0000-4000-8000-000000000140','uppercase provider evidence remains exact');
select is((select status from public.outbox_jobs where id='e5000000-0000-4000-8000-000000000071'),
  'completed','modern valid completion is not downgraded');
select is((select provider_message_id from public.outbox_provider_handoffs
  where job_id='e5000000-0000-4000-8000-000000000071'),
  'e5000000-0000-4000-8000-000000000170','modern provider evidence remains authoritative');
select is((select resolved_at from public.outbox_provider_handoffs
  where job_id='e5000000-0000-4000-8000-000000000071'),
  '2026-08-29 12:00:02.5+00'::timestamptz,'modern completion keeps its transactional timestamp');
select is((select count(*) from public.outbox_provider_handoffs where job_id in(
  'e5000000-0000-4000-8000-000000000011','e5000000-0000-4000-8000-000000000021',
  'e5000000-0000-4000-8000-000000000031','e5000000-0000-4000-8000-000000000071')),
  4::bigint,'repeated repair creates no duplicate handoffs');

select * from finish();
rollback;
