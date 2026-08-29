begin;
select no_plan();

insert into auth.users(id,email) values
  ('b4111111-1111-4111-8111-111111111111','owner-hardening@example.test'),
  ('b4222222-2222-4222-8222-222222222222','director-hardening@example.test'),
  ('b4333333-3333-4333-8333-333333333333','evaluator-hardening@example.test'),
  ('b4444444-4444-4444-8444-444444444444','boundary-hardening@example.test'),
  ('b4555555-5555-4555-8555-555555555555','replacement-hardening@example.test'),
  ('b4666666-6666-4666-8666-666666666666','orphan-hardening@example.test');
insert into public.profiles(id,display_name) values
  ('b4333333-3333-4333-8333-333333333333','Eva Exact'),
  ('b4444444-4444-4444-8444-444444444444','Boundary Eva');
insert into public.organizations(id,name,slug,timezone) values
  ('b4000000-0000-4000-8000-000000000001','Hardening A','staffing-hardening-a','America/Edmonton'),
  ('b4000000-0000-4000-8000-000000000002','Hardening B','staffing-hardening-b','America/Edmonton');
insert into public.organization_members(organization_id,user_id,role,status) values
  ('b4000000-0000-4000-8000-000000000001','b4111111-1111-4111-8111-111111111111','owner','active'),
  ('b4000000-0000-4000-8000-000000000001','b4222222-2222-4222-8222-222222222222','member','active'),
  ('b4000000-0000-4000-8000-000000000001','b4333333-3333-4333-8333-333333333333','member','active'),
  ('b4000000-0000-4000-8000-000000000001','b4444444-4444-4444-8444-444444444444','member','active'),
  ('b4000000-0000-4000-8000-000000000002','b4555555-5555-4555-8555-555555555555','owner','active');
insert into public.tryouts(id,organization_id,name,slug,sport,timezone,blind_mode) values
  ('b4777777-7777-4777-8777-777777777771','b4000000-0000-4000-8000-000000000001','Context Camp','context-camp','Hockey','America/Edmonton',true),
  ('b4777777-7777-4777-8777-777777777772','b4000000-0000-4000-8000-000000000002','Other Context Camp','other-context-camp','Hockey','America/Edmonton',true);
insert into public.tryout_divisions(id,organization_id,tryout_id,name,sort_order) values
  ('b4888888-8888-4888-8888-888888888881','b4000000-0000-4000-8000-000000000001','b4777777-7777-4777-8777-777777777771','U13',0),
  ('b4888888-8888-4888-8888-888888888882','b4000000-0000-4000-8000-000000000001','b4777777-7777-4777-8777-777777777771','U15',1);
insert into public.tryout_sessions(id,organization_id,tryout_id,division_id,name,starts_at,ends_at,sort_order) values
  ('b4999999-9999-4999-8999-999999999991','b4000000-0000-4000-8000-000000000001','b4777777-7777-4777-8777-777777777771','b4888888-8888-4888-8888-888888888881','Skills',clock_timestamp()+interval '1 day',clock_timestamp()+interval '1 day 1 hour',0),
  ('b4999999-9999-4999-8999-999999999992','b4000000-0000-4000-8000-000000000001','b4777777-7777-4777-8777-777777777771','b4888888-8888-4888-8888-888888888881','Game',clock_timestamp()+interval '2 days',clock_timestamp()+interval '2 days 1 hour',1),
  ('b4999999-9999-4999-8999-999999999993','b4000000-0000-4000-8000-000000000001','b4777777-7777-4777-8777-777777777771','b4888888-8888-4888-8888-888888888882','Sibling',clock_timestamp()+interval '3 days',clock_timestamp()+interval '3 days 1 hour',2);
insert into public.session_groups(id,organization_id,tryout_id,session_id,name,sort_order) values
  ('b4000000-0000-4000-8000-000000000091','b4000000-0000-4000-8000-000000000001','b4777777-7777-4777-8777-777777777771','b4999999-9999-4999-8999-999999999991','Blue',0),
  ('b4000000-0000-4000-8000-000000000092','b4000000-0000-4000-8000-000000000001','b4777777-7777-4777-8777-777777777771','b4999999-9999-4999-8999-999999999992','Gold',0);
insert into public.tryout_staff_assignments(organization_id,user_id,role,scope_kind,tryout_id,division_id,granted_by_user_id) values
  ('b4000000-0000-4000-8000-000000000001','b4222222-2222-4222-8222-222222222222','director','division','b4777777-7777-4777-8777-777777777771','b4888888-8888-4888-8888-888888888881','b4111111-1111-4111-8111-111111111111');

select ok(has_table_privilege('authenticated','public.tryout_staff_assignments','select'),'authenticated has only RLS-filtered assignment SELECT');
select ok(not has_table_privilege('anon','public.tryout_staff_assignments','select'),'anonymous has no assignment table privileges');
select ok(not has_table_privilege('service_role','public.tryout_staff_assignments','select'),'service role has no direct assignment SELECT');
select ok(not has_table_privilege('authenticated','public.tryout_staff_assignments','maintain'),'authenticated cannot maintain assignment table');
select ok(not has_table_privilege('service_role','public.tryout_staff_assignments','maintain'),'service role cannot maintain assignment table');
select ok(not has_table_privilege('authenticated','public.tryout_staff_assignments','truncate'),'authenticated cannot truncate assignment table');
select ok(not has_function_privilege('anon','public.assign_evaluator(uuid,uuid,uuid,text,uuid,uuid,uuid,timestamptz)','execute'),'anonymous cannot assign evaluators');
select ok(not has_function_privilege('service_role','public.assign_evaluator(uuid,uuid,uuid,text,uuid,uuid,uuid,timestamptz)','execute'),'service role cannot call evaluator assignment RPC');
select ok(has_function_privilege('authenticated','public.list_manageable_evaluator_assignments(uuid,uuid)','execute'),'authenticated may call manageable grants RPC subject to live authorization');
select is((select count(*) from information_schema.routine_privileges where specific_schema='public' and grantee='authenticated' and routine_name in ('assign_evaluator','revoke_evaluator_assignment','list_assigned_athletes','list_organization_evaluators','list_tryout_evaluator_candidates','list_manageable_evaluator_assignments','can_manage_evaluator_scope','revoke_orphaned_staff_assignments','revoke_staff_assignments_on_offboarding')),6::bigint,'authenticated receives exactly six intended evaluator RPC privileges');
select ok(has_function_privilege('authenticated','public.revoke_evaluator_assignment(uuid,uuid)','execute'),'authenticated may call authorized evaluator revocation RPC');
select ok(has_function_privilege('authenticated','public.list_assigned_athletes(uuid,uuid)','execute'),'authenticated may call own evaluator projection RPC');
select ok(has_function_privilege('authenticated','public.list_organization_evaluators(uuid)','execute'),'authenticated may call admin evaluator directory RPC');
select ok(has_function_privilege('authenticated','public.list_tryout_evaluator_candidates(uuid,uuid)','execute'),'authenticated may call scoped candidate RPC');
select ok(not has_function_privilege('authenticated','public.can_manage_evaluator_scope(uuid,uuid,text,uuid,uuid,uuid)','execute'),'authenticated cannot execute internal scope helper directly');
select ok(not has_function_privilege('authenticated','public.revoke_orphaned_staff_assignments()','execute'),'authenticated cannot execute migration backfill helper');
select ok(not has_function_privilege('authenticated','public.revoke_staff_assignments_on_offboarding()','execute'),'authenticated cannot execute membership trigger function');
select is((select count(*) from information_schema.routine_privileges where specific_schema='public' and grantee in ('PUBLIC','anon','service_role') and routine_name in ('assign_evaluator','revoke_evaluator_assignment','list_assigned_athletes','list_organization_evaluators','list_tryout_evaluator_candidates','list_manageable_evaluator_assignments','can_manage_evaluator_scope','revoke_orphaned_staff_assignments','revoke_staff_assignments_on_offboarding')),0::bigint,'public, anonymous, and service role receive no evaluator RPC execute privilege');

set local role authenticated;
select set_config('request.jwt.claim.sub','b4111111-1111-4111-8111-111111111111',true);
select is((select outcome from public.assign_evaluator('b4000000-0000-4000-8000-000000000001','b4333333-3333-4333-8333-333333333333','b4777777-7777-4777-8777-777777777771','tryout',null,null,null,null)),'assigned','owner grants tryout evaluation access');
select is((select outcome from public.assign_evaluator('b4000000-0000-4000-8000-000000000001','b4444444-4444-4444-8444-444444444444','b4777777-7777-4777-8777-777777777771','division','b4888888-8888-4888-8888-888888888881',null,null,null)),'assigned','owner grants boundary evaluator access');
reset role;

update public.organization_members set status='disabled'
where organization_id='b4000000-0000-4000-8000-000000000001' and user_id='b4333333-3333-4333-8333-333333333333';
select is((select count(*) from public.tryout_staff_assignments where organization_id='b4000000-0000-4000-8000-000000000001' and user_id='b4333333-3333-4333-8333-333333333333' and revoked_at is null),0::bigint,'disabling membership revokes active grants');
update public.organization_members set status='active'
where organization_id='b4000000-0000-4000-8000-000000000001' and user_id='b4333333-3333-4333-8333-333333333333';
select is((select count(*) from public.tryout_staff_assignments where organization_id='b4000000-0000-4000-8000-000000000001' and user_id='b4333333-3333-4333-8333-333333333333' and revoked_at is null),0::bigint,'re-enabling membership never revives revoked grants');
set local role authenticated;
select set_config('request.jwt.claim.sub','b4111111-1111-4111-8111-111111111111',true);
select is((select outcome from public.assign_evaluator('b4000000-0000-4000-8000-000000000001','b4333333-3333-4333-8333-333333333333','b4777777-7777-4777-8777-777777777771','tryout',null,null,null,null)),'assigned','authorized explicit regrant succeeds');
reset role;
select is((select count(*) from public.tryout_staff_assignments where organization_id='b4000000-0000-4000-8000-000000000001' and user_id='b4333333-3333-4333-8333-333333333333' and scope_kind='tryout'),2::bigint,'explicit regrant creates history instead of reactivating old row');
select is((select count(*) from public.audit_logs where organization_id='b4000000-0000-4000-8000-000000000001' and action='staffing.evaluator_assigned' and entity_id in (select id from public.tryout_staff_assignments where user_id='b4333333-3333-4333-8333-333333333333')),2::bigint,'initial grant and explicit regrant are audited');

update public.organization_members set organization_id='b4000000-0000-4000-8000-000000000002'
where organization_id='b4000000-0000-4000-8000-000000000001' and user_id='b4444444-4444-4444-8444-444444444444';
select is((select count(*) from public.tryout_staff_assignments where organization_id='b4000000-0000-4000-8000-000000000001' and user_id='b4444444-4444-4444-8444-444444444444' and revoked_at is null),0::bigint,'organization boundary move revokes old grants');
set local role authenticated;
select set_config('request.jwt.claim.sub','b4555555-5555-4555-8555-555555555555',true);
select is((select outcome from public.assign_evaluator('b4000000-0000-4000-8000-000000000002','b4444444-4444-4444-8444-444444444444','b4777777-7777-4777-8777-777777777772','tryout',null,null,null,null)),'assigned','destination owner grants access at the new organization boundary');
reset role;
update public.organization_members set user_id='b4666666-6666-4666-8666-666666666666'
where organization_id='b4000000-0000-4000-8000-000000000002' and user_id='b4444444-4444-4444-8444-444444444444';
select is((select count(*) from public.tryout_staff_assignments where organization_id='b4000000-0000-4000-8000-000000000002' and user_id='b4444444-4444-4444-8444-444444444444' and revoked_at is null),0::bigint,'user boundary move revokes old grants');

set local role authenticated;
select set_config('request.jwt.claim.sub','b4111111-1111-4111-8111-111111111111',true);
select is((select outcome from public.assign_evaluator('b4000000-0000-4000-8000-000000000001','b4333333-3333-4333-8333-333333333333','b4777777-7777-4777-8777-777777777771','division','b4888888-8888-4888-8888-888888888881',null,null,null)),'assigned','owner grants access for hard-delete proof');
reset role;
delete from public.organization_members where organization_id='b4000000-0000-4000-8000-000000000001' and user_id='b4333333-3333-4333-8333-333333333333';
select is((select count(*) from public.tryout_staff_assignments where organization_id='b4000000-0000-4000-8000-000000000001' and user_id='b4333333-3333-4333-8333-333333333333' and revoked_at is null),0::bigint,'hard membership delete revokes every active grant');

-- Simulate legacy drift and exercise the same idempotent backfill used by migration 040.
insert into public.organization_members(organization_id,user_id,role,status) values
  ('b4000000-0000-4000-8000-000000000001','b4444444-4444-4444-8444-444444444444','member','disabled');
insert into public.tryout_staff_assignments(organization_id,user_id,role,scope_kind,tryout_id,granted_by_user_id) values
  ('b4000000-0000-4000-8000-000000000001','b4666666-6666-4666-8666-666666666666','evaluator','tryout','b4777777-7777-4777-8777-777777777771','b4111111-1111-4111-8111-111111111111'),
  ('b4000000-0000-4000-8000-000000000001','b4333333-3333-4333-8333-333333333333','evaluator','tryout','b4777777-7777-4777-8777-777777777771','b4111111-1111-4111-8111-111111111111'),
  ('b4000000-0000-4000-8000-000000000001','b4444444-4444-4444-8444-444444444444','evaluator','tryout','b4777777-7777-4777-8777-777777777771','b4111111-1111-4111-8111-111111111111');
select is(public.revoke_orphaned_staff_assignments(),3::bigint,'upgrade backfill revokes missing, disabled, and wrong-organization membership grants');
select is((select count(*) from public.tryout_staff_assignments where user_id in ('b4666666-6666-4666-8666-666666666666','b4333333-3333-4333-8333-333333333333','b4444444-4444-4444-8444-444444444444') and revoked_at is null),0::bigint,'backfill leaves no invalid active grant');

-- Projection context and lifecycle gates.
insert into public.registration_forms(id,organization_id,tryout_id,name) values
  ('b4000000-0000-4000-8000-000000000011','b4000000-0000-4000-8000-000000000001','b4777777-7777-4777-8777-777777777771','Context form');
insert into public.registration_form_versions(id,organization_id,tryout_id,registration_form_id,version_number,schema,status,published_at) values
  ('b4000000-0000-4000-8000-000000000012','b4000000-0000-4000-8000-000000000001','b4777777-7777-4777-8777-777777777771','b4000000-0000-4000-8000-000000000011',1,'{"fields":[]}','published',clock_timestamp());
insert into public.athletes(id,organization_id,given_name,family_name,normalized_given_name,normalized_family_name,birth_date) values
  ('b4000000-0000-4000-8000-000000000013','b4000000-0000-4000-8000-000000000001','Hidden','Context','hidden','context','2013-01-01');
insert into public.tryout_registrations(id,organization_id,tryout_id,athlete_id,division_id,registration_form_version_id,responses,submission_key_digest,submission_digest) values
  ('b4000000-0000-4000-8000-000000000014','b4000000-0000-4000-8000-000000000001','b4777777-7777-4777-8777-777777777771','b4000000-0000-4000-8000-000000000013','b4888888-8888-4888-8888-888888888881','b4000000-0000-4000-8000-000000000012','{}',repeat('d',64),repeat('4',64));
insert into public.session_enrollments(organization_id,tryout_id,registration_id,session_id,group_id) values
  ('b4000000-0000-4000-8000-000000000001','b4777777-7777-4777-8777-777777777771','b4000000-0000-4000-8000-000000000014','b4999999-9999-4999-8999-999999999991','b4000000-0000-4000-8000-000000000091'),
  ('b4000000-0000-4000-8000-000000000001','b4777777-7777-4777-8777-777777777771','b4000000-0000-4000-8000-000000000014','b4999999-9999-4999-8999-999999999992','b4000000-0000-4000-8000-000000000092');
insert into public.organization_members(organization_id,user_id,role,status) values
  ('b4000000-0000-4000-8000-000000000001','b4333333-3333-4333-8333-333333333333','member','active');
set local role authenticated;
select set_config('request.jwt.claim.sub','b4111111-1111-4111-8111-111111111111',true);
select is((select outcome from public.assign_evaluator('b4000000-0000-4000-8000-000000000001','b4333333-3333-4333-8333-333333333333','b4777777-7777-4777-8777-777777777771','tryout',null,null,null,null)),'assigned','owner explicitly grants projection access after rejoin');
select is((select outcome from public.assign_evaluator('b4000000-0000-4000-8000-000000000001','b4333333-3333-4333-8333-333333333333','b4777777-7777-4777-8777-777777777771','division','b4888888-8888-4888-8888-888888888881',null,null,null)),'assigned','owner grants a division scope manageable by the scoped director');
select set_config('request.jwt.claim.sub','b4333333-3333-4333-8333-333333333333',true);
select is((select count(*) from public.list_assigned_athletes('b4000000-0000-4000-8000-000000000001','b4777777-7777-4777-8777-777777777771')),0::bigint,'draft tryout never projects athletes');
reset role;
set session_replication_role=replica;
update public.tryouts set status='published',published_at=clock_timestamp() where id='b4777777-7777-4777-8777-777777777771';
set session_replication_role=origin;
set local role authenticated;
select set_config('request.jwt.claim.sub','b4333333-3333-4333-8333-333333333333',true);
select is((select count(*) from public.list_assigned_athletes('b4000000-0000-4000-8000-000000000001','b4777777-7777-4777-8777-777777777771')),2::bigint,'tryout grant returns one deterministic row per session/group context');
select results_eq(
  $$select registration_id,division_id,session_id,group_id from public.list_assigned_athletes('b4000000-0000-4000-8000-000000000001','b4777777-7777-4777-8777-777777777771') order by session_id$$,
  $$values
    ('b4000000-0000-4000-8000-000000000014'::uuid,'b4888888-8888-4888-8888-888888888881'::uuid,'b4999999-9999-4999-8999-999999999991'::uuid,'b4000000-0000-4000-8000-000000000091'::uuid),
    ('b4000000-0000-4000-8000-000000000014'::uuid,'b4888888-8888-4888-8888-888888888881'::uuid,'b4999999-9999-4999-8999-999999999992'::uuid,'b4000000-0000-4000-8000-000000000092'::uuid)$$,
  'projection returns exact evaluation context IDs without PII'
);
reset role;
set session_replication_role=replica;
update public.tryouts set status='finalized',finalized_at=clock_timestamp() where id='b4777777-7777-4777-8777-777777777771';
set session_replication_role=origin;
set local role authenticated;
select set_config('request.jwt.claim.sub','b4333333-3333-4333-8333-333333333333',true);
select is((select count(*) from public.list_assigned_athletes('b4000000-0000-4000-8000-000000000001','b4777777-7777-4777-8777-777777777771')),2::bigint,'finalized tryout preserves exact evaluation contexts');

select set_config('request.jwt.claim.sub','b4222222-2222-4222-8222-222222222222',true);
select is((select active_assignment_count from public.list_tryout_evaluator_candidates('b4000000-0000-4000-8000-000000000001','b4777777-7777-4777-8777-777777777771') where evaluator_user_id='b4333333-3333-4333-8333-333333333333'),1::bigint,'scoped director count includes only grants they may manage');
select is((select count(*) from public.list_manageable_evaluator_assignments('b4000000-0000-4000-8000-000000000001','b4777777-7777-4777-8777-777777777771')),1::bigint,'scoped director lists only manageable active grants');
select ok(position('@' in coalesce((select row_to_json(x)::text from public.list_manageable_evaluator_assignments('b4000000-0000-4000-8000-000000000001','b4777777-7777-4777-8777-777777777771') x limit 1),''))=0,'manageable grants expose no evaluator contact data');
select set_config('request.jwt.claim.sub','b4111111-1111-4111-8111-111111111111',true);
select is((select count(*) from public.list_manageable_evaluator_assignments('b4000000-0000-4000-8000-000000000001','b4777777-7777-4777-8777-777777777771')),2::bigint,'owner lists every active evaluator grant in the tryout');

select * from finish();
rollback;
