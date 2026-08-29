begin;
select no_plan();

insert into auth.users(id,email) values
 ('e8111111-1111-4111-8111-111111111111','sync-owner@example.test'),
 ('e8333333-3333-4333-8333-333333333333','sync-evaluator@example.test');
insert into public.organizations(id,name,slug) values
 ('e8000000-0000-4000-8000-000000000001','Evaluation sync','evaluation-sync');
insert into public.organization_members(organization_id,user_id,role,status) values
 ('e8000000-0000-4000-8000-000000000001','e8111111-1111-4111-8111-111111111111','owner','active'),
 ('e8000000-0000-4000-8000-000000000001','e8333333-3333-4333-8333-333333333333','member','active');
insert into public.tryouts(id,organization_id,name,slug,sport,timezone) values
 ('e8666666-6666-4666-8666-666666666661','e8000000-0000-4000-8000-000000000001','Sync Camp','sync-camp','Hockey','America/Edmonton');
insert into public.tryout_divisions(id,organization_id,tryout_id,name,sort_order) values
 ('e8777777-7777-4777-8777-777777777771','e8000000-0000-4000-8000-000000000001','e8666666-6666-4666-8666-666666666661','Open',0);
insert into public.tryout_sessions(id,organization_id,tryout_id,division_id,name,starts_at,ends_at,sort_order) values
 ('e8888888-8888-4888-8888-888888888881','e8000000-0000-4000-8000-000000000001','e8666666-6666-4666-8666-666666666661','e8777777-7777-4777-8777-777777777771','Skills',clock_timestamp()+interval '1 day',clock_timestamp()+interval '1 day 1 hour',0);
insert into public.tryout_staff_assignments(organization_id,user_id,role,scope_kind,tryout_id,session_id,granted_by_user_id) values
 ('e8000000-0000-4000-8000-000000000001','e8333333-3333-4333-8333-333333333333','evaluator','session','e8666666-6666-4666-8666-666666666661','e8888888-8888-4888-8888-888888888881','e8111111-1111-4111-8111-111111111111');
insert into public.registration_forms(id,organization_id,tryout_id,name) values
 ('e8000000-0000-4000-8000-000000000011','e8000000-0000-4000-8000-000000000001','e8666666-6666-4666-8666-666666666661','Form');
insert into public.registration_form_versions(id,organization_id,tryout_id,registration_form_id,version_number,schema,status,published_at) values
 ('e8000000-0000-4000-8000-000000000012','e8000000-0000-4000-8000-000000000001','e8666666-6666-4666-8666-666666666661','e8000000-0000-4000-8000-000000000011',1,'{"fields":[]}','published',clock_timestamp());
insert into public.athletes(id,organization_id,given_name,family_name,normalized_given_name,normalized_family_name,birth_date) values
 ('e8000000-0000-4000-8000-000000000013','e8000000-0000-4000-8000-000000000001','Sync','Athlete','sync','athlete','2012-01-01');
insert into public.tryout_registrations(id,organization_id,tryout_id,athlete_id,division_id,registration_form_version_id,responses,submission_key_digest,submission_digest) values
 ('e8000000-0000-4000-8000-000000000014','e8000000-0000-4000-8000-000000000001','e8666666-6666-4666-8666-666666666661','e8000000-0000-4000-8000-000000000013','e8777777-7777-4777-8777-777777777771','e8000000-0000-4000-8000-000000000012','{}',repeat('e',64),repeat('8',64));
insert into public.session_enrollments(organization_id,tryout_id,registration_id,session_id) values
 ('e8000000-0000-4000-8000-000000000001','e8666666-6666-4666-8666-666666666661','e8000000-0000-4000-8000-000000000014','e8888888-8888-4888-8888-888888888881');
insert into public.rubrics(id,organization_id,tryout_id,name) values
 ('e8000000-0000-4000-8000-000000000021','e8000000-0000-4000-8000-000000000001','e8666666-6666-4666-8666-666666666661','Skills');
insert into public.rubric_versions(id,organization_id,tryout_id,rubric_id,version_number) values
 ('e8000000-0000-4000-8000-000000000022','e8000000-0000-4000-8000-000000000001','e8666666-6666-4666-8666-666666666661','e8000000-0000-4000-8000-000000000021',1);
insert into public.rubric_categories(id,organization_id,tryout_id,rubric_version_id,name,sort_order,weight,scale_min,scale_max) values
 ('e8000000-0000-4000-8000-000000000023','e8000000-0000-4000-8000-000000000001','e8666666-6666-4666-8666-666666666661','e8000000-0000-4000-8000-000000000022','Skating',0,100,1,5);
insert into public.session_rubrics(organization_id,tryout_id,session_id,rubric_version_id) values
 ('e8000000-0000-4000-8000-000000000001','e8666666-6666-4666-8666-666666666661','e8888888-8888-4888-8888-888888888881','e8000000-0000-4000-8000-000000000022');
set session_replication_role=replica;
update public.rubric_versions set status='published',published_at=clock_timestamp() where id='e8000000-0000-4000-8000-000000000022';
update public.tryouts set status='published',published_at=clock_timestamp() where id='e8666666-6666-4666-8666-666666666661';
set session_replication_role=origin;

select ok(has_function_privilege('authenticated','public.sync_evaluation_mutation(uuid,uuid,uuid,uuid,uuid,uuid,uuid,integer,jsonb)','execute'),'authenticated evaluator can execute sync command');
select ok(not has_table_privilege('authenticated','public.evaluation_mutations','select'),'authenticated cannot browse mutation receipts');
select ok(not has_table_privilege('authenticated','public.evaluation_mutations','insert'),'authenticated cannot forge mutation receipts');
select ok(not has_table_privilege('service_role','public.evaluation_mutations','select'),'service role cannot browse evaluator receipts');
select ok(not has_function_privilege('authenticated','private.record_evaluation_mutation_receipt(uuid,uuid,uuid,uuid,integer,text,text,integer)','execute'),'authenticated cannot mint receipts');

set local role authenticated;
select set_config('request.jwt.claim.sub','e8333333-3333-4333-8333-333333333333',true);
select set_config('app.test.sync_receipt',(select receipt::text from public.sync_evaluation_mutation(
 'e8000000-0000-4000-8000-000000000001','e8666666-6666-4666-8666-666666666661','e8888888-8888-4888-8888-888888888881',
 'e8000000-0000-4000-8000-000000000014','e8000000-0000-4000-8000-000000000022','e8000000-0000-4000-8000-000000000041',
 'e8000000-0000-4000-8000-000000000051',0,
 '{"scores":[{"categoryId":"e8000000-0000-4000-8000-000000000023","value":4}],"note":"Own note","noteTagIds":[],"flags":[]}')),true);
select is(current_setting('app.test.sync_receipt')::jsonb->>'outcome','synced','first device mutation synchronizes');
select is(current_setting('app.test.sync_receipt')::jsonb->>'serverVersion','1','first device mutation creates exact version one');
select is(current_setting('app.test.sync_receipt')::jsonb->>'payloadDigest','f502ce258ac95f0b687f5e154b2b5550176057b981ebb06422a67c0edac8c869','server digest matches the Task 16 canonical browser payload');
select is((select receipt::text from public.sync_evaluation_mutation(
 'e8000000-0000-4000-8000-000000000001','e8666666-6666-4666-8666-666666666661','e8888888-8888-4888-8888-888888888881',
 'e8000000-0000-4000-8000-000000000014','e8000000-0000-4000-8000-000000000022','e8000000-0000-4000-8000-000000000041',
 'e8000000-0000-4000-8000-000000000051',0,
 '{"scores":[{"categoryId":"e8000000-0000-4000-8000-000000000023","value":4}],"note":"Own note","noteTagIds":[],"flags":[]}')),current_setting('app.test.sync_receipt'),'exact replay returns the byte-equivalent receipt');
reset role;
select is((select count(*) from public.evaluations where organization_id='e8000000-0000-4000-8000-000000000001'),1::bigint,'replay creates no duplicate evaluation');
select is((select version from public.evaluations where id='e8000000-0000-4000-8000-000000000041'),1,'replay does not increment the evaluation');
select throws_ok($$set local role authenticated; select set_config('request.jwt.claim.sub','e8333333-3333-4333-8333-333333333333',true); select * from public.sync_evaluation_mutation(
 'e8000000-0000-4000-8000-000000000001','e8666666-6666-4666-8666-666666666661','e8888888-8888-4888-8888-888888888881',
 'e8000000-0000-4000-8000-000000000014','e8000000-0000-4000-8000-000000000022','e8000000-0000-4000-8000-000000000041',
 'e8000000-0000-4000-8000-000000000051',0,
 '{"scores":[{"categoryId":"e8000000-0000-4000-8000-000000000023","value":5}],"noteTagIds":[],"flags":[]}')$$,'TF409','client mutation id already binds another payload','changed replay conflicts');

set local role authenticated;
select set_config('request.jwt.claim.sub','e8333333-3333-4333-8333-333333333333',true);
select is((select receipt->>'outcome' from public.sync_evaluation_mutation(
 'e8000000-0000-4000-8000-000000000001','e8666666-6666-4666-8666-666666666661','e8888888-8888-4888-8888-888888888881',
 'e8000000-0000-4000-8000-000000000014','e8000000-0000-4000-8000-000000000022','e8000000-0000-4000-8000-000000000041',
 'e8000000-0000-4000-8000-000000000052',0,
 '{"scores":[{"categoryId":"e8000000-0000-4000-8000-000000000023","value":5}],"noteTagIds":[],"flags":[]}')),'conflict','stale version receives recoverable conflict');
reset role;
select is((select version from public.evaluations where id='e8000000-0000-4000-8000-000000000041'),1,'stale conflict preserves server version');
select is((select value from public.evaluation_scores where evaluation_id='e8000000-0000-4000-8000-000000000041'),4,'stale conflict preserves server score');

delete from public.tryout_staff_assignments
where organization_id='e8000000-0000-4000-8000-000000000001'
  and user_id='e8333333-3333-4333-8333-333333333333';
set local role authenticated;
select set_config('request.jwt.claim.sub','e8333333-3333-4333-8333-333333333333',true);
select is((select receipt->>'outcome' from public.sync_evaluation_mutation(
 'e8000000-0000-4000-8000-000000000001','e8666666-6666-4666-8666-666666666661','e8888888-8888-4888-8888-888888888881',
 'e8000000-0000-4000-8000-000000000014','e8000000-0000-4000-8000-000000000022','e8000000-0000-4000-8000-000000000041',
 'e8000000-0000-4000-8000-000000000053',1,
 '{"scores":[{"categoryId":"e8000000-0000-4000-8000-000000000023","value":5}],"noteTagIds":[],"flags":[]}')),'forbidden','revoked execution-time assignment fails closed');
reset role;
select is((select version from public.evaluations where id='e8000000-0000-4000-8000-000000000041'),1,'revoked assignment preserves local server version');

insert into public.tryout_staff_assignments(organization_id,user_id,role,scope_kind,tryout_id,session_id,granted_by_user_id) values
 ('e8000000-0000-4000-8000-000000000001','e8333333-3333-4333-8333-333333333333','evaluator','session','e8666666-6666-4666-8666-666666666661','e8888888-8888-4888-8888-888888888881','e8111111-1111-4111-8111-111111111111');
set session_replication_role=replica;
delete from public.session_rubrics
where organization_id='e8000000-0000-4000-8000-000000000001'
  and session_id='e8888888-8888-4888-8888-888888888881';
set session_replication_role=origin;
set local role authenticated;
select set_config('request.jwt.claim.sub','e8333333-3333-4333-8333-333333333333',true);
select is((select receipt->>'outcome' from public.sync_evaluation_mutation(
 'e8000000-0000-4000-8000-000000000001','e8666666-6666-4666-8666-666666666661','e8888888-8888-4888-8888-888888888881',
 'e8000000-0000-4000-8000-000000000014','e8000000-0000-4000-8000-000000000022','e8000000-0000-4000-8000-000000000041',
 'e8000000-0000-4000-8000-000000000054',1,
 '{"scores":[{"categoryId":"e8000000-0000-4000-8000-000000000023","value":5}],"noteTagIds":[],"flags":[]}')),'invalid_rubric','session rubric change fails closed');
reset role;
select is((select value from public.evaluation_scores where evaluation_id='e8000000-0000-4000-8000-000000000041'),4,'rubric change preserves server data');

select * from finish();
rollback;
