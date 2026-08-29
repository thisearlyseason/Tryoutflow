begin;
select no_plan();

insert into auth.users(id,email) values
  ('a3111111-1111-4111-8111-111111111111','owner@example.test'),
  ('a3222222-2222-4222-8222-222222222222','director@example.test'),
  ('a3333333-3333-4333-8333-333333333333','evaluator@example.test'),
  ('a3444444-4444-4444-8444-444444444444','outsider@example.test'),
  ('a3555555-5555-4555-8555-555555555555','disabled@example.test');
insert into public.profiles(id,display_name) values
  ('a3333333-3333-4333-8333-333333333333','Evan Evaluator');
insert into public.organizations(id,name,slug,timezone) values
  ('a3000000-0000-4000-8000-000000000001','Staffing A','staffing-a','America/Edmonton'),
  ('a3000000-0000-4000-8000-000000000002','Staffing B','staffing-b','America/Edmonton');
insert into public.organization_members(organization_id,user_id,role,status) values
  ('a3000000-0000-4000-8000-000000000001','a3111111-1111-4111-8111-111111111111','owner','active'),
  ('a3000000-0000-4000-8000-000000000001','a3222222-2222-4222-8222-222222222222','member','active'),
  ('a3000000-0000-4000-8000-000000000001','a3333333-3333-4333-8333-333333333333','member','active'),
  ('a3000000-0000-4000-8000-000000000001','a3555555-5555-4555-8555-555555555555','member','disabled'),
  ('a3000000-0000-4000-8000-000000000002','a3444444-4444-4444-8444-444444444444','owner','active');
insert into public.tryouts(id,organization_id,name,slug,sport,timezone,blind_mode) values
  ('a3666666-6666-4666-8666-666666666661','a3000000-0000-4000-8000-000000000001','Blind Camp','staffing-blind','Hockey','America/Edmonton',true),
  ('a3666666-6666-4666-8666-666666666662','a3000000-0000-4000-8000-000000000001','Full Camp','staffing-full','Hockey','America/Edmonton',false),
  ('a3666666-6666-4666-8666-666666666663','a3000000-0000-4000-8000-000000000002','Other Camp','staffing-other','Hockey','America/Edmonton',false);
insert into public.tryout_divisions(id,organization_id,tryout_id,name,sort_order) values
  ('a3777777-7777-4777-8777-777777777771','a3000000-0000-4000-8000-000000000001','a3666666-6666-4666-8666-666666666661','U13',0),
  ('a3777777-7777-4777-8777-777777777772','a3000000-0000-4000-8000-000000000001','a3666666-6666-4666-8666-666666666661','U15',1),
  ('a3777777-7777-4777-8777-777777777773','a3000000-0000-4000-8000-000000000001','a3666666-6666-4666-8666-666666666662','Open',0);
insert into public.tryout_sessions(id,organization_id,tryout_id,division_id,name,starts_at,ends_at,sort_order) values
  ('a3888888-8888-4888-8888-888888888881','a3000000-0000-4000-8000-000000000001','a3666666-6666-4666-8666-666666666661','a3777777-7777-4777-8777-777777777771','Skills',clock_timestamp()+interval '1 day',clock_timestamp()+interval '1 day 1 hour',0),
  ('a3888888-8888-4888-8888-888888888882','a3000000-0000-4000-8000-000000000001','a3666666-6666-4666-8666-666666666661','a3777777-7777-4777-8777-777777777772','Scrimmage',clock_timestamp()+interval '1 day',clock_timestamp()+interval '1 day 1 hour',0),
  ('a3888888-8888-4888-8888-888888888883','a3000000-0000-4000-8000-000000000001','a3666666-6666-4666-8666-666666666662','a3777777-7777-4777-8777-777777777773','Full',clock_timestamp()+interval '2 days',clock_timestamp()+interval '2 days 1 hour',0);
insert into public.session_groups(id,organization_id,tryout_id,session_id,name,sort_order) values
  ('a3999999-9999-4999-8999-999999999991','a3000000-0000-4000-8000-000000000001','a3666666-6666-4666-8666-666666666661','a3888888-8888-4888-8888-888888888881','Blue',0),
  ('a3999999-9999-4999-8999-999999999992','a3000000-0000-4000-8000-000000000001','a3666666-6666-4666-8666-666666666661','a3888888-8888-4888-8888-888888888881','Gold',1);
insert into public.tryout_staff_assignments(organization_id,user_id,role,scope_kind,tryout_id,division_id,granted_by_user_id) values
  ('a3000000-0000-4000-8000-000000000001','a3222222-2222-4222-8222-222222222222','director','division','a3666666-6666-4666-8666-666666666661','a3777777-7777-4777-8777-777777777771','a3111111-1111-4111-8111-111111111111');
insert into public.tryout_staff_assignments(organization_id,user_id,role,scope_kind,tryout_id,expires_at,granted_by_user_id,created_at) values
  ('a3000000-0000-4000-8000-000000000001','a3333333-3333-4333-8333-333333333333','evaluator','tryout','a3666666-6666-4666-8666-666666666662',clock_timestamp()-interval '1 day','a3111111-1111-4111-8111-111111111111',clock_timestamp()-interval '2 days');
insert into public.registration_forms(id,organization_id,tryout_id,name) values
  ('a3000000-0000-4000-8000-000000000011','a3000000-0000-4000-8000-000000000001','a3666666-6666-4666-8666-666666666661','Blind form'),
  ('a3000000-0000-4000-8000-000000000012','a3000000-0000-4000-8000-000000000001','a3666666-6666-4666-8666-666666666662','Full form');
insert into public.registration_form_versions(id,organization_id,tryout_id,registration_form_id,version_number,schema,status,published_at) values
  ('a3000000-0000-4000-8000-000000000021','a3000000-0000-4000-8000-000000000001','a3666666-6666-4666-8666-666666666661','a3000000-0000-4000-8000-000000000011',1,'{"fields":[]}','published',clock_timestamp()),
  ('a3000000-0000-4000-8000-000000000022','a3000000-0000-4000-8000-000000000001','a3666666-6666-4666-8666-666666666662','a3000000-0000-4000-8000-000000000012',1,'{"fields":[]}','published',clock_timestamp());
insert into public.athletes(id,organization_id,given_name,family_name,normalized_given_name,normalized_family_name,birth_date) values
  ('a3000000-0000-4000-8000-000000000031','a3000000-0000-4000-8000-000000000001','Blue','Athlete','blue','athlete','2013-01-01'),
  ('a3000000-0000-4000-8000-000000000032','a3000000-0000-4000-8000-000000000001','Gold','Athlete','gold','athlete','2013-01-02'),
  ('a3000000-0000-4000-8000-000000000033','a3000000-0000-4000-8000-000000000001','Full','Identity','full','identity','2012-01-01');
insert into public.tryout_registrations(id,organization_id,tryout_id,athlete_id,division_id,registration_form_version_id,responses,submission_key_digest,submission_digest) values
  ('a3000000-0000-4000-8000-000000000041','a3000000-0000-4000-8000-000000000001','a3666666-6666-4666-8666-666666666661','a3000000-0000-4000-8000-000000000031','a3777777-7777-4777-8777-777777777771','a3000000-0000-4000-8000-000000000021','{}',repeat('a',64),repeat('1',64)),
  ('a3000000-0000-4000-8000-000000000042','a3000000-0000-4000-8000-000000000001','a3666666-6666-4666-8666-666666666661','a3000000-0000-4000-8000-000000000032','a3777777-7777-4777-8777-777777777771','a3000000-0000-4000-8000-000000000021','{}',repeat('b',64),repeat('2',64)),
  ('a3000000-0000-4000-8000-000000000043','a3000000-0000-4000-8000-000000000001','a3666666-6666-4666-8666-666666666662','a3000000-0000-4000-8000-000000000033','a3777777-7777-4777-8777-777777777773','a3000000-0000-4000-8000-000000000022','{}',repeat('c',64),repeat('3',64));
insert into public.session_enrollments(organization_id,tryout_id,registration_id,session_id,group_id) values
  ('a3000000-0000-4000-8000-000000000001','a3666666-6666-4666-8666-666666666661','a3000000-0000-4000-8000-000000000041','a3888888-8888-4888-8888-888888888881','a3999999-9999-4999-8999-999999999991'),
  ('a3000000-0000-4000-8000-000000000001','a3666666-6666-4666-8666-666666666661','a3000000-0000-4000-8000-000000000042','a3888888-8888-4888-8888-888888888881','a3999999-9999-4999-8999-999999999992'),
  ('a3000000-0000-4000-8000-000000000001','a3666666-6666-4666-8666-666666666662','a3000000-0000-4000-8000-000000000043','a3888888-8888-4888-8888-888888888883',null);
set session_replication_role=replica;
update public.tryouts set status='published',published_at=clock_timestamp() where id in ('a3666666-6666-4666-8666-666666666661','a3666666-6666-4666-8666-666666666662');
set session_replication_role=origin;

select ok(not has_function_privilege('anon','public.list_assigned_athletes(uuid,uuid)','execute'),'anonymous cannot execute evaluator projection');
select ok(has_function_privilege('authenticated','public.list_assigned_athletes(uuid,uuid)','execute'),'authenticated may execute evaluator projection subject to live authorization');
select ok(not has_table_privilege('authenticated','public.tryout_staff_assignments','insert'),'authenticated cannot bypass evaluator assignment command');
select ok(not has_table_privilege('authenticated','public.tryout_staff_assignments','update'),'authenticated cannot directly reactivate or revoke grants');

set local role authenticated;
select set_config('request.jwt.claim.sub','a3222222-2222-4222-8222-222222222222',true);
select is((select count(*) from public.list_tryout_evaluator_candidates('a3000000-0000-4000-8000-000000000001','a3666666-6666-4666-8666-666666666661')),3::bigint,'scoped director can staff from active member names without contact data');
select is((select outcome from public.assign_evaluator('a3000000-0000-4000-8000-000000000001','a3333333-3333-4333-8333-333333333333','a3666666-6666-4666-8666-666666666661','group',null,'a3888888-8888-4888-8888-888888888881','a3999999-9999-4999-8999-999999999991',null)),'assigned','division director assigns evaluator within exact group');
select is((select outcome from public.assign_evaluator('a3000000-0000-4000-8000-000000000001','a3333333-3333-4333-8333-333333333333','a3666666-6666-4666-8666-666666666661','session',null,'a3888888-8888-4888-8888-888888888882',null,null)),'forbidden','division director cannot assign another division');
select is((select outcome from public.assign_evaluator('a3000000-0000-4000-8000-000000000001','a3333333-3333-4333-8333-333333333333','a3666666-6666-4666-8666-666666666661','group',null,'a3888888-8888-4888-8888-888888888882','a3999999-9999-4999-8999-999999999991',null)),'invalid_scope','mismatched session and group is rejected');
select is((select outcome from public.assign_evaluator('a3000000-0000-4000-8000-000000000001','a3555555-5555-4555-8555-555555555555','a3666666-6666-4666-8666-666666666661','division','a3777777-7777-4777-8777-777777777771',null,null,null)),'not_member','disabled evaluator cannot receive a grant');
select is((select outcome from public.assign_evaluator('a3000000-0000-4000-8000-000000000001','a3333333-3333-4333-8333-333333333333','a3666666-6666-4666-8666-666666666661','group',null,'a3888888-8888-4888-8888-888888888881','a3999999-9999-4999-8999-999999999991',null)),'duplicate','duplicate active grant is rejected');

select set_config('request.jwt.claim.sub','a3333333-3333-4333-8333-333333333333',true);
select is((select count(*) from public.list_assigned_athletes('a3000000-0000-4000-8000-000000000001','a3666666-6666-4666-8666-666666666661')),1::bigint,'group evaluator receives only exact enrolled athlete');
select is((select identity_mode from public.list_assigned_athletes('a3000000-0000-4000-8000-000000000001','a3666666-6666-4666-8666-666666666661')),'blind','published blind setting controls projection');
select ok(position('Blue' in (select display_name from public.list_assigned_athletes('a3000000-0000-4000-8000-000000000001','a3666666-6666-4666-8666-666666666661')))=0,'blind projection omits athlete identity');
select is((select count(*) from public.list_assigned_athletes('a3000000-0000-4000-8000-000000000002','a3666666-6666-4666-8666-666666666663')),0::bigint,'known cross-tenant UUIDs reveal no athletes');
select is((select count(*) from public.list_assigned_athletes('a3000000-0000-4000-8000-000000000001','a3666666-6666-4666-8666-666666666662')),0::bigint,'unassigned tryout reveals no full identities');

select set_config('request.jwt.claim.sub','a3111111-1111-4111-8111-111111111111',true);
select set_config('app.test.group_assignment_id',(select id::text from public.tryout_staff_assignments where user_id='a3333333-3333-4333-8333-333333333333' and scope_kind='group' and revoked_at is null),true);
select is((select outcome from public.assign_evaluator('a3000000-0000-4000-8000-000000000001','a3333333-3333-4333-8333-333333333333','a3666666-6666-4666-8666-666666666662','tryout',null,null,null,null)),'assigned','owner assigns full-identity tryout scope');
select is((select count(*) from public.tryout_staff_assignments where user_id='a3333333-3333-4333-8333-333333333333' and tryout_id='a3666666-6666-4666-8666-666666666662' and scope_kind='tryout' and revoked_at is not null),1::bigint,'expired matching grant is revoked before safe regrant');
select set_config('request.jwt.claim.sub','a3333333-3333-4333-8333-333333333333',true);
select is((select display_name from public.list_assigned_athletes('a3000000-0000-4000-8000-000000000001','a3666666-6666-4666-8666-666666666662')),'Full Identity','non-blind published setting returns full athlete name');

select set_config('request.jwt.claim.sub','a3444444-4444-4444-8444-444444444444',true);
select is((select outcome from public.assign_evaluator('a3000000-0000-4000-8000-000000000001','a3333333-3333-4333-8333-333333333333','a3666666-6666-4666-8666-666666666661','tryout',null,null,null,null)),'forbidden','cross-tenant owner cannot assign a known evaluator UUID');

select set_config('request.jwt.claim.sub','a3222222-2222-4222-8222-222222222222',true);
select is((select outcome from public.revoke_evaluator_assignment('a3000000-0000-4000-8000-000000000001',current_setting('app.test.group_assignment_id')::uuid)),'revoked','exact director can revoke evaluator group grant');
select set_config('request.jwt.claim.sub','a3111111-1111-4111-8111-111111111111',true);
select is((select count(*) from public.audit_logs where action='staffing.evaluator_revoked' and organization_id='a3000000-0000-4000-8000-000000000001'),1::bigint,'revocation is audited');
select set_config('request.jwt.claim.sub','a3333333-3333-4333-8333-333333333333',true);
select is((select count(*) from public.list_assigned_athletes('a3000000-0000-4000-8000-000000000001','a3666666-6666-4666-8666-666666666661')),0::bigint,'revocation removes access immediately');

reset role;
update public.organization_members set status='disabled' where organization_id='a3000000-0000-4000-8000-000000000001' and user_id='a3333333-3333-4333-8333-333333333333';
select is((select count(*) from public.tryout_staff_assignments where organization_id='a3000000-0000-4000-8000-000000000001' and user_id='a3333333-3333-4333-8333-333333333333' and revoked_at is null),0::bigint,'offboarding revokes every active evaluator assignment');
select * from finish();
rollback;
