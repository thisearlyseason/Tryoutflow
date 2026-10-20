begin;
select plan(19);

select has_function('public','load_report_export',array['uuid','text','uuid','uuid','integer']);
select has_function('public','load_report_summary',array['uuid','uuid']);
select has_function('public','load_onboarding_facts',array['uuid']);
select is((select proconfig from pg_proc where oid=to_regprocedure('public.load_report_export(uuid,text,uuid,uuid,integer)')),array['search_path=""']::text[],'export projection has an empty search path');
select has_function(
  'private','bounded_report_evaluation_candidates',array['uuid','uuid','integer'],
  'evaluation candidates are bounded before report joins and grouping'
);
select ok(has_function_privilege('authenticated','public.load_report_export(uuid,text,uuid,uuid,integer)','execute'),'authenticated users can call guarded export projection');
select ok(not has_function_privilege('anon','public.load_report_export(uuid,text,uuid,uuid,integer)','execute'),'anonymous users cannot export');
select ok(not has_function_privilege('service_role','public.load_report_export(uuid,text,uuid,uuid,integer)','execute'),'service role cannot bypass actor export authority');

insert into auth.users(id) values
  ('64000000-0000-4000-8000-000000000011'),
  ('64000000-0000-4000-8000-000000000012'),
  ('64000000-0000-4000-8000-000000000013'),
  ('64000000-0000-4000-8000-000000000014');
insert into public.organizations(id,name,slug,timezone,terminology,sport_defaults,tag_defaults)
values('64000000-0000-4000-8000-000000000021','Task 29 Reports','task-29-reports','America/Edmonton','{"athlete":"Player"}','["Hockey"]','["Prospect"]');
insert into public.organization_members(organization_id,user_id,role,status) values
  ('64000000-0000-4000-8000-000000000021','64000000-0000-4000-8000-000000000011','owner','active'),
  ('64000000-0000-4000-8000-000000000021','64000000-0000-4000-8000-000000000012','member','active'),
  ('64000000-0000-4000-8000-000000000021','64000000-0000-4000-8000-000000000013','member','active'),
  ('64000000-0000-4000-8000-000000000021','64000000-0000-4000-8000-000000000014','member','disabled');
insert into public.tryouts(id,organization_id,name,slug,sport,timezone)
values('64000000-0000-4000-8000-000000000022','64000000-0000-4000-8000-000000000021','Report Tryout','task-29-report-tryout','Hockey','America/Edmonton');
insert into public.tryout_staff_assignments(id,organization_id,user_id,role,scope_kind,tryout_id,granted_by_user_id) values
  ('64000000-0000-4000-8000-000000000023','64000000-0000-4000-8000-000000000021','64000000-0000-4000-8000-000000000012','evaluator','tryout','64000000-0000-4000-8000-000000000022','64000000-0000-4000-8000-000000000011'),
  ('64000000-0000-4000-8000-000000000024','64000000-0000-4000-8000-000000000021','64000000-0000-4000-8000-000000000013','director','tryout','64000000-0000-4000-8000-000000000022','64000000-0000-4000-8000-000000000011');

set local role authenticated;
select set_config('request.jwt.claim.sub','64000000-0000-4000-8000-000000000011',true);
select is((select result->>'outcome' from public.load_report_export('64000000-0000-4000-8000-000000000021','athletes',null,null,5000)),'ok','owner can export bounded organization athlete snapshot');
select is((select result->>'outcome' from public.load_report_export('64000000-0000-4000-8000-000000000021','athletes',null,null,5001)),'forbidden','row limit cannot be widened');
select ok((select result::text !~* 'birth|guardian|email|phone|emergency|eligibility|note|evaluatorUserId' from public.load_report_export('64000000-0000-4000-8000-000000000021','athletes',null,null,5000)),'athlete snapshot omits private fields');

select set_config('request.jwt.claim.sub','64000000-0000-4000-8000-000000000012',true);
select is((select result->>'outcome' from public.load_report_export('64000000-0000-4000-8000-000000000021','evaluations','64000000-0000-4000-8000-000000000022',null,5000)),'forbidden','evaluator cannot export evaluation reports');
select set_config('request.jwt.claim.sub','64000000-0000-4000-8000-000000000013',true);
select is((select result->>'outcome' from public.load_report_export('64000000-0000-4000-8000-000000000021','evaluations','64000000-0000-4000-8000-000000000022',null,5000)),'ok','tryout-scoped director can export the assigned report');
select ok((select result::text !~* 'note|evaluator_user|evaluatorId' from public.load_report_export('64000000-0000-4000-8000-000000000021','evaluations','64000000-0000-4000-8000-000000000022',null,5000)),'general evaluation export omits notes and evaluator identity');
select is((select result->>'outcome' from public.load_report_export('64000000-0000-4000-8000-000000000021','evaluations','64000000-0000-4000-8000-000000000099',null,5000)),'forbidden','invalid scope uses the same denial as unauthorized scope');
select set_config('request.jwt.claim.sub','64000000-0000-4000-8000-000000000014',true);
select is((select result->>'outcome' from public.load_report_export('64000000-0000-4000-8000-000000000021','evaluations','64000000-0000-4000-8000-000000000022',null,5000)),'forbidden','offboarded member is denied at execution time');
select is((select result->>'outcome' from public.load_onboarding_facts('64000000-0000-4000-8000-000000000021')),'forbidden','offboarded member cannot inspect onboarding facts');

reset role;
select is((select provolatile from pg_proc where oid=to_regprocedure('public.load_report_export(uuid,text,uuid,uuid,integer)')),'s','export projection is stable');
select is((select provolatile from pg_proc where oid=to_regprocedure('public.load_onboarding_facts(uuid)')),'s','onboarding facts are a durable stable projection');

select * from finish();
rollback;
