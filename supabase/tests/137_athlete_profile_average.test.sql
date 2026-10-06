begin;
select no_plan();

insert into auth.users(id,email) values
 ('e1111111-1111-4111-8111-111111111111','eval-owner@example.test'),
 ('e1222222-2222-4222-8222-222222222222','eval-director@example.test'),
 ('e1333333-3333-4333-8333-333333333333','eval-a@example.test'),
 ('e1444444-4444-4444-8444-444444444444','eval-b@example.test'),
 ('e1555555-5555-4555-8555-555555555555','eval-other@example.test');
insert into public.organizations(id,name,slug) values
 ('e1000000-0000-4000-8000-000000000001','Evaluation A','evaluation-a'),
 ('e1000000-0000-4000-8000-000000000002','Evaluation B','evaluation-b');
insert into public.organization_members(organization_id,user_id,role,status) values
 ('e1000000-0000-4000-8000-000000000001','e1111111-1111-4111-8111-111111111111','owner','active'),
 ('e1000000-0000-4000-8000-000000000001','e1222222-2222-4222-8222-222222222222','member','active'),
 ('e1000000-0000-4000-8000-000000000001','e1333333-3333-4333-8333-333333333333','member','active'),
 ('e1000000-0000-4000-8000-000000000001','e1444444-4444-4444-8444-444444444444','member','active'),
 ('e1000000-0000-4000-8000-000000000002','e1555555-5555-4555-8555-555555555555','owner','active');
insert into public.tryouts(id,organization_id,name,slug,sport,timezone) values
 ('e1666666-6666-4666-8666-666666666661','e1000000-0000-4000-8000-000000000001','Evaluation Camp','evaluation-camp','Hockey','America/Edmonton'),
 ('e1666666-6666-4666-8666-666666666662','e1000000-0000-4000-8000-000000000002','Other Camp','evaluation-other','Hockey','America/Edmonton');
insert into public.tryout_divisions(id,organization_id,tryout_id,name,sort_order) values
 ('e1777777-7777-4777-8777-777777777771','e1000000-0000-4000-8000-000000000001','e1666666-6666-4666-8666-666666666661','Open',0);
insert into public.tryout_sessions(id,organization_id,tryout_id,division_id,name,starts_at,ends_at,sort_order) values
 ('e1888888-8888-4888-8888-888888888881','e1000000-0000-4000-8000-000000000001','e1666666-6666-4666-8666-666666666661','e1777777-7777-4777-8777-777777777771','Skills',clock_timestamp()+interval '1 day',clock_timestamp()+interval '1 day 1 hour',0);
insert into public.tryout_staff_assignments(organization_id,user_id,role,scope_kind,tryout_id,session_id,granted_by_user_id) values
 ('e1000000-0000-4000-8000-000000000001','e1222222-2222-4222-8222-222222222222','director','session','e1666666-6666-4666-8666-666666666661','e1888888-8888-4888-8888-888888888881','e1111111-1111-4111-8111-111111111111'),
 ('e1000000-0000-4000-8000-000000000001','e1333333-3333-4333-8333-333333333333','evaluator','session','e1666666-6666-4666-8666-666666666661','e1888888-8888-4888-8888-888888888881','e1111111-1111-4111-8111-111111111111'),
 ('e1000000-0000-4000-8000-000000000001','e1444444-4444-4444-8444-444444444444','evaluator','session','e1666666-6666-4666-8666-666666666661','e1888888-8888-4888-8888-888888888881','e1111111-1111-4111-8111-111111111111');
insert into public.registration_forms(id,organization_id,tryout_id,name) values
 ('e1000000-0000-4000-8000-000000000011','e1000000-0000-4000-8000-000000000001','e1666666-6666-4666-8666-666666666661','Form');
insert into public.registration_form_versions(id,organization_id,tryout_id,registration_form_id,version_number,schema,status,published_at) values
 ('e1000000-0000-4000-8000-000000000012','e1000000-0000-4000-8000-000000000001','e1666666-6666-4666-8666-666666666661','e1000000-0000-4000-8000-000000000011',1,'{"fields":[]}','published',clock_timestamp());
insert into public.athletes(id,organization_id,given_name,family_name,normalized_given_name,normalized_family_name,birth_date) values
 ('e1000000-0000-4000-8000-000000000013','e1000000-0000-4000-8000-000000000001','Test','Athlete','test','athlete','2012-01-01');
insert into public.tryout_registrations(id,organization_id,tryout_id,athlete_id,division_id,registration_form_version_id,responses,submission_key_digest,submission_digest) values
 ('e1000000-0000-4000-8000-000000000014','e1000000-0000-4000-8000-000000000001','e1666666-6666-4666-8666-666666666661','e1000000-0000-4000-8000-000000000013','e1777777-7777-4777-8777-777777777771','e1000000-0000-4000-8000-000000000012','{}',repeat('e',64),repeat('5',64));
insert into public.session_enrollments(organization_id,tryout_id,registration_id,session_id) values
 ('e1000000-0000-4000-8000-000000000001','e1666666-6666-4666-8666-666666666661','e1000000-0000-4000-8000-000000000014','e1888888-8888-4888-8888-888888888881');
insert into public.rubrics(id,organization_id,tryout_id,name) values
 ('e1000000-0000-4000-8000-000000000021','e1000000-0000-4000-8000-000000000001','e1666666-6666-4666-8666-666666666661','Skills');
insert into public.rubric_versions(id,organization_id,tryout_id,rubric_id,version_number) values
 ('e1000000-0000-4000-8000-000000000022','e1000000-0000-4000-8000-000000000001','e1666666-6666-4666-8666-666666666661','e1000000-0000-4000-8000-000000000021',1);
insert into public.rubric_categories(id,organization_id,tryout_id,rubric_version_id,name,sort_order,weight,scale_min,scale_max) values
 ('e1000000-0000-4000-8000-000000000023','e1000000-0000-4000-8000-000000000001','e1666666-6666-4666-8666-666666666661','e1000000-0000-4000-8000-000000000022','Skating',0,50,1,5),
 ('e1000000-0000-4000-8000-000000000024','e1000000-0000-4000-8000-000000000001','e1666666-6666-4666-8666-666666666661','e1000000-0000-4000-8000-000000000022','Passing',1,50,1,10);
insert into public.session_rubrics(organization_id,tryout_id,session_id,rubric_version_id) values
 ('e1000000-0000-4000-8000-000000000001','e1666666-6666-4666-8666-666666666661','e1888888-8888-4888-8888-888888888881','e1000000-0000-4000-8000-000000000022');
set session_replication_role=replica;
update public.rubric_versions set status='published',published_at=clock_timestamp() where id='e1000000-0000-4000-8000-000000000022';
update public.tryouts set status='published',published_at=clock_timestamp() where id in
 ('e1666666-6666-4666-8666-666666666661','e1666666-6666-4666-8666-666666666662');
set session_replication_role=origin;
insert into public.organization_evaluation_note_tags(id,organization_id,label) values
 ('e1000000-0000-4000-8000-000000000031','e1000000-0000-4000-8000-000000000001','Needs another look');


select ok(not has_function_privilege('anon','public.load_athlete_profile_average(uuid,uuid,uuid,uuid,uuid)','execute'),'anonymous cannot query profiles');
select ok(not has_function_privilege('service_role','public.load_athlete_profile_average(uuid,uuid,uuid,uuid,uuid)','execute'),'service role cannot bypass profile authorization');
set session_replication_role=replica;
insert into public.evaluations(id,organization_id,tryout_id,division_id,tryout_registration_id,tryout_session_id,evaluator_user_id,rubric_version_id,state,completed_at) values
 ('e1000000-0000-4000-8000-000000000041','e1000000-0000-4000-8000-000000000001','e1666666-6666-4666-8666-666666666661','e1777777-7777-4777-8777-777777777771','e1000000-0000-4000-8000-000000000014','e1888888-8888-4888-8888-888888888881','e1333333-3333-4333-8333-333333333333','e1000000-0000-4000-8000-000000000022','completed',now()),
 ('e1000000-0000-4000-8000-000000000042','e1000000-0000-4000-8000-000000000001','e1666666-6666-4666-8666-666666666661','e1777777-7777-4777-8777-777777777771','e1000000-0000-4000-8000-000000000014','e1888888-8888-4888-8888-888888888881','e1444444-4444-4444-8444-444444444444','e1000000-0000-4000-8000-000000000022','locked',now());
insert into public.evaluation_scores(organization_id,tryout_id,evaluation_id,rubric_version_id,rubric_category_id,value) values
 ('e1000000-0000-4000-8000-000000000001','e1666666-6666-4666-8666-666666666661','e1000000-0000-4000-8000-000000000041','e1000000-0000-4000-8000-000000000022','e1000000-0000-4000-8000-000000000023',3),
 ('e1000000-0000-4000-8000-000000000001','e1666666-6666-4666-8666-666666666661','e1000000-0000-4000-8000-000000000041','e1000000-0000-4000-8000-000000000022','e1000000-0000-4000-8000-000000000024',7),
 ('e1000000-0000-4000-8000-000000000001','e1666666-6666-4666-8666-666666666661','e1000000-0000-4000-8000-000000000042','e1000000-0000-4000-8000-000000000022','e1000000-0000-4000-8000-000000000023',4);
set session_replication_role=origin;
set local role authenticated;
select set_config('request.jwt.claim.sub','e1333333-3333-4333-8333-333333333333',true);
select set_config('app.test.profile',(public.load_athlete_profile_average('e1000000-0000-4000-8000-000000000001','e1666666-6666-4666-8666-666666666661','e1000000-0000-4000-8000-000000000014','e1888888-8888-4888-8888-888888888881','e1000000-0000-4000-8000-000000000022'))::text,true);
select is((current_setting('app.test.profile')::jsonb->>'evaluationCount')::int,2,'completed and locked evaluations included');
select is((current_setting('app.test.profile')::jsonb->'scores'->0->>'value')::numeric,3.5::numeric,'fractional criterion average is exact');
select is((current_setting('app.test.profile')::jsonb->'scores'->1->>'value')::numeric,7::numeric,'missing peer criterion never becomes zero');
select is((current_setting('app.test.profile')::jsonb->'scores'->1->>'count')::int,1,'each criterion has its own denominator');
select is((select count(*) from jsonb_object_keys(current_setting('app.test.profile')::jsonb)),2::bigint,'only count and aggregate scores exposed');
select is((select count(*) from public.evaluations),1::bigint,'aggregate does not grant direct access to peer evaluations');
select is(public.load_athlete_profile_average('e1000000-0000-4000-8000-000000000001','e1666666-6666-4666-8666-666666666661','e1000000-0000-4000-8000-000000000014','e1888888-8888-4888-8888-888888888881','e1000000-0000-4000-8000-000000000099'),null::jsonb,'unrelated rubric denied');
select is(public.load_athlete_profile_average('e1000000-0000-4000-8000-000000000002','e1666666-6666-4666-8666-666666666661','e1000000-0000-4000-8000-000000000014','e1888888-8888-4888-8888-888888888881','e1000000-0000-4000-8000-000000000022'),null::jsonb,'cross tenant request denied');
select is(public.load_athlete_profile_average('e1000000-0000-4000-8000-000000000001','e1666666-6666-4666-8666-666666666661','e1000000-0000-4000-8000-000000000014','e1888888-8888-4888-8888-888888888882','e1000000-0000-4000-8000-000000000022'),null::jsonb,'unassigned session denied');
reset role;
set session_replication_role=replica;
update public.evaluations set state='reopened',completed_at=null where id='e1000000-0000-4000-8000-000000000042';
set session_replication_role=origin;
set local role authenticated;
select is((public.load_athlete_profile_average('e1000000-0000-4000-8000-000000000001','e1666666-6666-4666-8666-666666666661','e1000000-0000-4000-8000-000000000014','e1888888-8888-4888-8888-888888888881','e1000000-0000-4000-8000-000000000022')->>'evaluationCount')::int,1,'reopened evaluations excluded');
reset role;
set session_replication_role=replica;
update public.evaluations set state='draft' where id='e1000000-0000-4000-8000-000000000042';
set session_replication_role=origin;
set local role authenticated;
select is((public.load_athlete_profile_average('e1000000-0000-4000-8000-000000000001','e1666666-6666-4666-8666-666666666661','e1000000-0000-4000-8000-000000000014','e1888888-8888-4888-8888-888888888881','e1000000-0000-4000-8000-000000000022')->>'evaluationCount')::int,1,'draft evaluations excluded');
reset role;
set session_replication_role=replica;
update public.evaluations set state='locked',completed_at=now(),rubric_version_id='e1000000-0000-4000-8000-000000000099' where id='e1000000-0000-4000-8000-000000000042';
set session_replication_role=origin;
set local role authenticated;
select is((public.load_athlete_profile_average('e1000000-0000-4000-8000-000000000001','e1666666-6666-4666-8666-666666666661','e1000000-0000-4000-8000-000000000014','e1888888-8888-4888-8888-888888888881','e1000000-0000-4000-8000-000000000022')->>'evaluationCount')::int,1,'different rubric versions never averaged');
reset role;
set session_replication_role=replica;
update public.evaluations set rubric_version_id='e1000000-0000-4000-8000-000000000022' where id='e1000000-0000-4000-8000-000000000042';
delete from public.tryout_staff_assignments where user_id='e1444444-4444-4444-8444-444444444444';
set session_replication_role=origin;
set local role authenticated;
select is((public.load_athlete_profile_average('e1000000-0000-4000-8000-000000000001','e1666666-6666-4666-8666-666666666661','e1000000-0000-4000-8000-000000000014','e1888888-8888-4888-8888-888888888881','e1000000-0000-4000-8000-000000000022')->>'evaluationCount')::int,1,'revoked peer contributions excluded like rankings');
select set_config('request.jwt.claim.sub','e1444444-4444-4444-8444-444444444444',true);
select is(public.load_athlete_profile_average('e1000000-0000-4000-8000-000000000001','e1666666-6666-4666-8666-666666666661','e1000000-0000-4000-8000-000000000014','e1888888-8888-4888-8888-888888888881','e1000000-0000-4000-8000-000000000022'),null::jsonb,'revoked caller denied');
select * from finish();
rollback;
