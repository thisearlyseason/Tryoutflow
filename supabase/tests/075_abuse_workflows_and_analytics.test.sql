begin;

set local search_path=extensions,public;
select plan(26);

select has_table('private','abuse_rate_limits','shared abuse counters are durable');
select has_table('private','bot_token_receipts','bot replay receipts are durable');
select has_table('public','analytics_outbox_events','analytics events use a durable outbox');
select table_privs_are('public','analytics_outbox_events','authenticated',array[]::text[],'analytics outbox has no direct client path');
select function_privs_are('public','consume_abuse_rate_limit',array['text','text','text','integer','integer'],'service_role',array['EXECUTE'],'service routes consume shared rate limits through one narrow RPC');
select function_privs_are('public','consume_bot_token_once',array['text','text','integer'],'service_role',array['EXECUTE'],'service routes record bot-token replay through one narrow RPC');
select function_privs_are('public','enqueue_analytics_event',array['uuid','text','text','text'],'authenticated',array['EXECUTE'],'authenticated workflows enqueue closed analytics events');
select function_privs_are('public','create_tryout_draft_with_cycle',array['uuid','uuid','text','text','text','text','text','timestamp with time zone','timestamp with time zone'],'authenticated',array['EXECUTE'],'tryout creation resolves a cycle atomically');
select function_privs_are('public','create_staff_registration',array['uuid','uuid','uuid','uuid','uuid','text','text','date','jsonb','text'],'authenticated',array['EXECUTE'],'manual and returning registrations use a guarded command');
select function_privs_are('public','list_returning_athletes',array['uuid','uuid','text','integer'],'authenticated',array['EXECUTE'],'returning-athlete lookup is guarded and bounded');
select function_privs_are('public','load_staff_registration_configuration',array['uuid','uuid'],'authenticated',array['EXECUTE'],'staff registration configuration uses one guarded projection');

set local role service_role;
select is((select allowed from public.consume_abuse_rate_limit(repeat('a',64),repeat('b',64),'auth_sign_in',2,60)),true,'first shared attempt is allowed');
select is((select allowed from public.consume_abuse_rate_limit(repeat('a',64),repeat('b',64),'auth_sign_in',2,60)),true,'second shared attempt is allowed');
select is((select allowed from public.consume_abuse_rate_limit(repeat('a',64),repeat('b',64),'auth_sign_in',2,60)),false,'shared limit is atomic and saturating');
select is((select allowed from public.consume_abuse_rate_limit(repeat('a',64),repeat('c',64),'auth_sign_in',2,60)),true,'trusted-address digest participates in the key');
select is((select consumed from public.consume_bot_token_once(repeat('d',64),'sign_in',300)),true,'first verified token digest is recorded');
select is((select consumed from public.consume_bot_token_once(repeat('d',64),'sign_in',300)),false,'verified token replay is rejected');
reset role;

insert into auth.users(id,email,email_confirmed_at) values ('94000000-0000-4000-8000-000000000001','flow-owner@example.test',clock_timestamp());
insert into public.organizations(id,name,slug) values ('94100000-0000-4000-8000-000000000001','Workflow Org','workflow-org');
insert into public.organization_members(organization_id,user_id,role,status) values ('94100000-0000-4000-8000-000000000001','94000000-0000-4000-8000-000000000001','owner','active');

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','94000000-0000-4000-8000-000000000001',true);
select is((select season_name from public.create_tryout_draft_with_cycle(
  '94100000-0000-4000-8000-000000000001',null,'2027 Spring','Cycle Tryout','cycle-tryout','Hockey','America/Edmonton',clock_timestamp(),clock_timestamp()+interval '7 days')),'2027 Spring','new cycle is created and selected atomically');
select is((select count(*) from public.seasons where organization_id='94100000-0000-4000-8000-000000000001' and name='2027 Spring'),1::bigint,'cycle creation is durable once');
select is((select count(*) from public.tryouts where organization_id='94100000-0000-4000-8000-000000000001' and season_id is not null),1::bigint,'tryout is bound to the selected cycle');

select is((select outcome from public.enqueue_analytics_event('94100000-0000-4000-8000-000000000001','workflow.completed','onboarding','corr-123')),'queued','closed analytics event is queued');
select throws_ok($$select * from public.analytics_outbox_events$$,'42501',null,'analytics outbox has no direct client read path');
select throws_ok($$select * from public.enqueue_analytics_event('94100000-0000-4000-8000-000000000001','raw_score','evaluation','corr-123')$$,'22023',null,'unapproved analytics event names fail closed');
reset role;
select is((select count(*) from public.analytics_outbox_events where event_name='workflow.completed'),1::bigint,'analytics evidence is durable after successful enqueue');
select ok((select payload = '{}'::jsonb from public.analytics_outbox_events where event_name='workflow.completed'),'analytics rows cannot contain tenant content');
select is((select count(*) from public.audit_logs where action='tryout.created' and organization_id='94100000-0000-4000-8000-000000000001'),1::bigint,'cycle-aware tryout creation keeps immutable audit evidence');

select * from finish();
rollback;
