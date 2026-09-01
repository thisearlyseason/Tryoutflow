begin;

set local search_path=extensions,public;

select plan(56);

select has_table('public','platform_administrators','platform authority has a durable relation');
select ok((select relrowsecurity from pg_class where oid='public.platform_administrators'::regclass),'platform authority has RLS enabled');
select policies_are('public','platform_administrators',array[]::name[],'platform authority has no direct caller policy');
select table_privs_are('public','platform_administrators','anon',array[]::text[],'anonymous has no platform authority table privileges');
select table_privs_are('public','platform_administrators','authenticated',array[]::text[],'authenticated has no platform authority table privileges');
select table_privs_are('public','platform_administrators','service_role',array[]::text[],'service role cannot bypass platform authority');
select table_privs_are('public','platform_support_elevations','authenticated',array[]::text[],'support evidence remains inaccessible directly');
select table_privs_are('public','platform_support_elevations','service_role',array[]::text[],'service role cannot mutate support evidence directly');

select function_privs_are('public','public_health_check',array[]::text[],'anon',array['EXECUTE'],'anonymous can invoke only coarse health');
select function_privs_are('public','public_health_check',array[]::text[],'authenticated',array['EXECUTE'],'authenticated can invoke coarse health');
select function_privs_are('public','public_health_check',array[]::text[],'service_role',array[]::text[],'service role has no public health bypass');
select function_privs_are('public','begin_support_elevation',array['uuid','text','timestamp with time zone'],'authenticated',array['EXECUTE'],'authenticated callers reach the guarded support command');
select function_privs_are('public','begin_support_elevation',array['uuid','text','timestamp with time zone'],'anon',array[]::text[],'anonymous cannot begin support access');
select function_privs_are('public','begin_support_elevation',array['uuid','text','timestamp with time zone'],'service_role',array[]::text[],'service role cannot silently impersonate support');
select function_privs_are('public','has_active_platform_support_elevation',array['uuid'],'authenticated',array[]::text[],'support authority remains an owner-only authorization helper');
select function_privs_are('public','has_active_platform_support_elevation',array['uuid'],'service_role',array[]::text[],'service role cannot bypass the support authorization helper');
select function_privs_are('public','platform_health',array[]::text[],'authenticated',array['EXECUTE'],'authenticated callers reach the guarded detailed health query');
select function_privs_are('public','platform_health',array[]::text[],'anon',array[]::text[],'anonymous cannot invoke detailed health');
select ok((select convalidated from pg_constraint where conname='platform_support_elevations_reason_not_blank'),'legacy reason evidence is covered by a validated active-row constraint');
select ok((select convalidated from pg_constraint where conname='platform_support_elevations_reason_bound_check'),'support reason bounds are validated for the complete authoritative relation');
select ok((select convalidated from pg_constraint where conname='platform_support_elevations_duration_bound_check'),'support duration bounds are validated for the complete authoritative relation');
select is(
  (select count(*) from pg_proc routine join pg_namespace namespace on namespace.oid=routine.pronamespace
    where namespace.nspname='public' and routine.proname in(
      'is_active_platform_administrator','platform_health','platform_list_organizations',
      'platform_list_subscriptions','platform_list_audit_events','platform_list_support_elevations',
      'begin_support_elevation','has_active_platform_support_elevation'
    ) and routine.prosecdef and routine.proconfig=array['search_path=""']::text[]),
  8::bigint,
  'every privileged platform function is SECURITY DEFINER with an empty search path'
);

set local role anon;
select set_config('request.jwt.claim.role','anon',true);
select set_config('request.jwt.claim.sub','',true);
select is((select status from public.public_health_check()),'ok','public health exposes only coarse availability');
reset role;

insert into auth.users(id) values
  ('81000000-0000-4000-8000-000000000001'),
  ('81000000-0000-4000-8000-000000000002'),
  ('81000000-0000-4000-8000-000000000003');
insert into public.organizations(id,name,slug) values
  ('82000000-0000-4000-8000-000000000001','Task 32 Organization','task-32-organization');
insert into public.organization_members(organization_id,user_id,role,status) values
  ('82000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000002','owner','active');
insert into public.platform_administrators(user_id,granted_by_user_id) values
  ('81000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000003');

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','81000000-0000-4000-8000-000000000002',true);
select is(
  (select outcome from public.begin_support_elevation(
    '82000000-0000-4000-8000-000000000001','Investigate support ticket T32-100',clock_timestamp()+interval '30 minutes')),
  'forbidden',
  'organization owners cannot elevate into platform support'
);
select throws_ok($$select * from public.platform_health()$$,'42501',null,'non-platform callers cannot read detailed health');
select throws_ok($$select * from public.platform_list_organizations(20)$$,'42501',null,'non-platform callers cannot enumerate organizations');

select set_config('request.jwt.claim.sub','81000000-0000-4000-8000-000000000001',true);
select is(
  (select outcome from public.begin_support_elevation(
    '82000000-0000-4000-8000-000000000001','short',clock_timestamp()+interval '30 minutes')),
  'invalid_reason',
  'support reason is mandatory and bounded'
);
select is(
  (select outcome from public.begin_support_elevation(
    '82000000-0000-4000-8000-000000000001','Investigate support ticket T32-100',clock_timestamp()+interval '1 minute')),
  'invalid_expiry',
  'support elevation cannot be too short to be actionable'
);
select is(
  (select outcome from public.begin_support_elevation(
    '82000000-0000-4000-8000-000000000001','Investigate support ticket T32-100',clock_timestamp()+interval '5 hours')),
  'invalid_expiry',
  'support elevation cannot exceed the four-hour maximum'
);
select is(
  (select outcome from public.begin_support_elevation(
    '82000000-0000-4000-8000-000000000099','Investigate support ticket T32-100',clock_timestamp()+interval '30 minutes')),
  'not_found',
  'support elevation returns a non-content-bearing result for an absent tenant'
);
select is(
  (select outcome from public.begin_support_elevation(
    '82000000-0000-4000-8000-000000000001','  Investigate support ticket T32-100  ',clock_timestamp()+interval '30 minutes')),
  'started',
  'a platform administrator can begin bounded support access for themself'
);
select is((select count(*) from public.platform_list_support_elevations(20) where organization_id='82000000-0000-4000-8000-000000000001'),1::bigint,'support evidence is durable');
select is((select count(*) from public.platform_list_audit_events(20) where organization_id='82000000-0000-4000-8000-000000000001' and action='platform.support_elevation.started'),1::bigint,'support elevation appends audit evidence in the same transaction');
reset role;
select ok(public.has_active_platform_support_elevation('82000000-0000-4000-8000-000000000001'),'support authority is active only while its platform actor remains authorized');
select ok((select not(details ? 'reason') from public.audit_logs where organization_id='82000000-0000-4000-8000-000000000001' and action='platform.support_elevation.started'),'support reason is not copied into generic audit metadata');
set local role authenticated;
select is((select reason from public.platform_list_support_elevations(20) where organization_id='82000000-0000-4000-8000-000000000001'),'Investigate support ticket T32-100','the bounded reason is stored only on support evidence');
select is(
  (select outcome from public.begin_support_elevation(
    '82000000-0000-4000-8000-000000000001','Investigate support ticket T32-101',clock_timestamp()+interval '30 minutes')),
  'conflict',
  'a second active elevation is not created silently'
);
select is((select count(*) from public.platform_list_organizations(20) where organization_id='82000000-0000-4000-8000-000000000001'),1::bigint,'platform organization metadata is available to current administrators');
select is((select count(*) from public.platform_list_subscriptions(20) where organization_id='82000000-0000-4000-8000-000000000001' and plan_key='trial'),1::bigint,'platform subscription view exposes allow-listed entitlement state');
select ok((select database_status='ok' and failed_jobs>=0 and webhook_failures>=0 and communication_failures>=0 and integration_failures>=0 and synchronization_problems>=0 from public.platform_health()),'detailed health exposes only aggregate operational state');
select is((select count(*) from public.platform_list_audit_events(20) where action='platform.support_elevation.started'),1::bigint,'platform audit view returns safe immutable event fields');
select is((select count(*) from public.platform_list_support_elevations(20) where reason='Investigate support ticket T32-100'),1::bigint,'platform support view returns explicit support evidence');

reset role;
alter table public.platform_support_elevations
  drop constraint platform_support_elevations_reason_not_blank,
  drop constraint platform_support_elevations_reason_bound_check,
  drop constraint platform_support_elevations_duration_bound_check;
update public.platform_support_elevations set reason='short';
select ok(not public.has_active_platform_support_elevation('82000000-0000-4000-8000-000000000001'),'legacy short reasons never confer support authority');
update public.platform_support_elevations set reason=repeat('x',501);
select ok(not public.has_active_platform_support_elevation('82000000-0000-4000-8000-000000000001'),'legacy overlong reasons never confer support authority');
update public.platform_support_elevations set reason='Investigate'||chr(10)||'ticket T32-100';
select ok(not public.has_active_platform_support_elevation('82000000-0000-4000-8000-000000000001'),'legacy control characters never confer support authority');
update public.platform_support_elevations set reason='Investigate support ticket T32-100',created_at=clock_timestamp()-interval '1 minute',expires_at=clock_timestamp()+interval '1 minute';
select ok(not public.has_active_platform_support_elevation('82000000-0000-4000-8000-000000000001'),'legacy elevations shorter than five minutes never confer authority while current');
update public.platform_support_elevations set created_at=clock_timestamp()-interval '1 minute',expires_at=clock_timestamp()+interval '4 hours';
select ok(not public.has_active_platform_support_elevation('82000000-0000-4000-8000-000000000001'),'legacy elevations longer than four hours never confer authority while current');
update public.platform_support_elevations set created_at=clock_timestamp()+interval '1 hour',expires_at=clock_timestamp()+interval '90 minutes';
select ok(not public.has_active_platform_support_elevation('82000000-0000-4000-8000-000000000001'),'future-created legacy elevations never confer early authority');
update public.platform_support_elevations set created_at=clock_timestamp()-interval '10 minutes',expires_at=clock_timestamp()-interval '5 minutes';
select ok(not public.has_active_platform_support_elevation('82000000-0000-4000-8000-000000000001'),'expired legacy elevations remain inactive');
update public.platform_support_elevations set created_at=statement_timestamp()-interval '1 minute',expires_at=statement_timestamp()+interval '4 minutes';
select ok(public.has_active_platform_support_elevation('82000000-0000-4000-8000-000000000001'),'exactly five-minute current elevations remain authoritative');
update public.platform_support_elevations set created_at=statement_timestamp()-interval '1 minute',expires_at=statement_timestamp()+interval '3 hours 59 minutes';
select ok(public.has_active_platform_support_elevation('82000000-0000-4000-8000-000000000001'),'exactly four-hour current elevations remain authoritative');
update public.platform_support_elevations set created_at=clock_timestamp(),expires_at=clock_timestamp()+interval '30 minutes';
update public.platform_administrators set status='disabled',disabled_at=clock_timestamp()
where user_id='81000000-0000-4000-8000-000000000001';
select ok(not public.has_active_platform_support_elevation('82000000-0000-4000-8000-000000000001'),'disabling platform authority immediately disables an unexpired support elevation');
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','81000000-0000-4000-8000-000000000001',true);
select throws_ok($$select * from public.platform_health()$$,'42501',null,'platform authorization is rechecked at execution time');
select throws_ok($$update public.audit_logs set action='changed' where organization_id='82000000-0000-4000-8000-000000000001'$$,'42501',null,'authenticated callers cannot mutate audit evidence');
select throws_ok($$select * from public.platform_administrators$$,'42501',null,'authenticated callers cannot inspect platform authority rows directly');
select throws_ok($$select * from public.platform_support_elevations$$,'42501',null,'authenticated callers cannot inspect support evidence directly');

select * from finish();
rollback;
