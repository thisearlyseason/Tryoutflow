begin;
select plan(34);

select has_column('public','outbox_provider_handoffs','send_attempt_token','handoff has an opaque send-attempt capability');
select has_column('public','outbox_provider_handoffs','provider_idempotency_key','handoff binds the provider idempotency identity');
select has_column('public','outbox_provider_handoffs','message_id','handoff binds the immutable message');
select has_column('public','outbox_provider_handoffs','attempt_state','handoff retains append-only outcome truth');
select has_function('public','authorize_outbox_job_send_v2',array['uuid','uuid','bigint','integer','integer'],
  'database-budgeted exclusive authorization exists');
select has_function('public','complete_outbox_job_v2',array['uuid','uuid','bigint','uuid','text'],
  'completion requires the exact attempt capability');
select has_function('public','decline_outbox_job_send_v2',array['uuid','uuid','bigint','uuid','text'],
  'decline requires the exact attempt capability');
select ok(has_function_privilege('service_role','public.authorize_outbox_job_send_v2(uuid,uuid,bigint,integer,integer)','execute'),
  'service worker may request exclusive authorization');
select ok(not has_function_privilege('authenticated','public.authorize_outbox_job_send_v2(uuid,uuid,bigint,integer,integer)','execute'),
  'clients cannot request send capabilities');

insert into auth.users(id,email) values('c3000000-0000-4000-8000-000000000001','owner-c3@example.com');
insert into public.organizations(id,name,slug)
values('c3000000-0000-4000-8000-000000000002','Exclusive Send Test','exclusive-send-test');
insert into public.organization_members(organization_id,user_id,role,status)
values('c3000000-0000-4000-8000-000000000002','c3000000-0000-4000-8000-000000000001','owner','active');
insert into public.organization_invitations(id,organization_id,email,role,token_digest,expires_at,created_by_user_id)
values('c3000000-0000-4000-8000-000000000003','c3000000-0000-4000-8000-000000000002','invite-c3@example.com','member',repeat('c',64),clock_timestamp()+interval '1 day','c3000000-0000-4000-8000-000000000001');
insert into public.communication_messages(
  id,organization_id,source_kind,source_id,message_kind,notice_class,business_idempotency_key,
  request_digest,recipient_snapshot,content_snapshot,source_binding_version,
  source_invitation_token_digest,source_authorizing_user_id
) values(
  'c3000000-0000-4000-8000-000000000004','c3000000-0000-4000-8000-000000000002',
  'invitation','c3000000-0000-4000-8000-000000000003','member_invitation','operational',
  'task22:exclusive:0001',repeat('d',64),'{"email":"invite-c3@example.com"}',
  '{"subject":"Invite","text":"Body"}',1,repeat('c',64),'c3000000-0000-4000-8000-000000000001'
);
insert into public.outbox_jobs(
  id,organization_id,message_id,business_idempotency_key,provider_idempotency_key,status,
  attempt_count,lease_owner,lease_token,lease_generation,lease_expires_at
) values(
  'c3000000-0000-4000-8000-000000000005','c3000000-0000-4000-8000-000000000002',
  'c3000000-0000-4000-8000-000000000004','task22:exclusive:0001',
  'communication:c3000000-0000-4000-8000-000000000004','leased',1,'worker-exclusive',
  'c3000000-0000-4000-8000-000000000006',1,clock_timestamp()+interval '90 seconds'
);

create temporary table task22_authorizations(result jsonb);
grant select,insert on task22_authorizations to service_role;
set local role service_role;
insert into task22_authorizations select public.authorize_outbox_job_send_v2(
  'c3000000-0000-4000-8000-000000000005','c3000000-0000-4000-8000-000000000006',1,45000,15000);
insert into task22_authorizations select public.authorize_outbox_job_send_v2(
  'c3000000-0000-4000-8000-000000000005','c3000000-0000-4000-8000-000000000006',1,45000,15000);
reset role;

select is((select result->>'outcome' from task22_authorizations order by ctid limit 1),'authorized',
  'first routine exclusively owns the send');
select ok((select (result->>'send_attempt_token')::uuid is not null from task22_authorizations order by ctid limit 1),
  'owner receives an opaque attempt capability');
select is((select (result->>'send_budget_ms')::integer from task22_authorizations order by ctid limit 1),45000,
  'database bounds the granted provider budget');
select is((select result->>'outcome' from task22_authorizations order by ctid desc limit 1),'in_progress',
  'same-lease replay does not receive ownership');
select ok((select result->'send_attempt_token'='null'::jsonb from task22_authorizations order by ctid desc limit 1),
  'non-owner receives no usable capability');
select is((select count(*) from public.outbox_provider_handoffs where job_id='c3000000-0000-4000-8000-000000000005'),1::bigint,
  'one generation has exactly one provider attempt');

set local role service_role;
select is(public.complete_outbox_job_v2(
  'c3000000-0000-4000-8000-000000000005','c3000000-0000-4000-8000-000000000006',1,
  'c3000000-0000-4000-8000-000000000099','c3000000-0000-4000-8000-000000000010'),
  'attempt_conflict','wrong attempt token cannot manufacture completion');
select is(public.complete_outbox_job_v2(
  'c3000000-0000-4000-8000-000000000005','c3000000-0000-4000-8000-000000000006',1,
  (select (result->>'send_attempt_token')::uuid from task22_authorizations order by ctid limit 1),
  'c3000000-0000-4000-8000-000000000010'),'completed','exact owner can complete');
reset role;
select is((select attempt_state from public.outbox_provider_handoffs where job_id='c3000000-0000-4000-8000-000000000005'),
  'completed','completion truth remains on the attempt lineage');

select throws_ok($$delete from public.organizations where id='c3000000-0000-4000-8000-000000000002'$$,
  '55000',null,'organization deletion cannot cascade communication evidence');
select throws_ok('truncate table public.communication_messages cascade','55000',null,
  'owner cannot truncate communication evidence');
set local session_replication_role=replica;
select throws_ok('truncate table public.outbox_jobs cascade','55000',null,
  'replica mode cannot truncate communication evidence');
set local session_replication_role=origin;

set local role service_role;
select throws_ok($$update public.outbox_provider_handoffs set attempt_state='completed'$$,'42501',null,
  'service cannot directly rewrite attempt truth');
select throws_ok($$delete from public.outbox_provider_handoffs$$,'42501',null,
  'service cannot directly delete attempt truth');
reset role;

select throws_ok($$insert into public.outbox_provider_handoffs(
  organization_id,job_id,message_id,lease_token,lease_generation,provider_idempotency_key,
  send_attempt_token,started_at,attempt_state
) values(
  'c3000000-0000-4000-8000-000000000002','c3000000-0000-4000-8000-000000000005',
  'c3000000-0000-4000-8000-000000000004','c3000000-0000-4000-8000-000000000006',2,
  'communication:c3000000-0000-4000-8000-000000000004',gen_random_uuid(),
  clock_timestamp()+interval '1 minute','authorized')$$,'23514',null,
  'future authorization timestamps fail closed');
select throws_ok($$update public.outbox_provider_handoffs set message_id=gen_random_uuid()$$,'55000',null,
  'attempt message binding cannot be redirected');
select ok(not has_table_privilege('service_role','public.outbox_provider_handoffs','select'),
  'service cannot enumerate bearer capabilities');
select ok(not has_table_privilege('service_role','public.outbox_provider_handoffs','truncate'),
  'service cannot truncate capability history');
select ok((select confdeltype='r' from pg_constraint where conrelid='public.communication_messages'::regclass
  and confrelid='public.organizations'::regclass),'organization parent path uses restrictive retention');
select ok((select confdeltype='r' from pg_constraint where conrelid='public.outbox_jobs'::regclass
  and confrelid='public.communication_messages'::regclass),'message parent path cannot cascade job evidence');
select ok((select confdeltype='r' from pg_constraint where conrelid='public.outbox_provider_handoffs'::regclass
  and confrelid='public.outbox_jobs'::regclass),'job parent path cannot cascade attempt evidence');
select ok(not has_function_privilege('service_role','public.authorize_outbox_job_send(uuid,uuid,bigint)','execute'),
  'tokenless legacy authorization is closed');
select ok(not has_function_privilege('service_role','public.complete_outbox_job(uuid,uuid,bigint,text)','execute'),
  'tokenless legacy completion is closed');
select ok(not has_function_privilege('service_role','public.fail_outbox_job(uuid,uuid,bigint,text,boolean)','execute'),
  'tokenless legacy failure is closed');
select ok(not has_function_privilege('service_role','public.decline_outbox_job_send(uuid,uuid,bigint,text)','execute'),
  'tokenless legacy decline is closed');

select * from finish();
rollback;
