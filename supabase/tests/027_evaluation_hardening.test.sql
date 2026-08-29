begin;
select no_plan();

insert into auth.users(id,email) values
 ('f1111111-1111-4111-8111-111111111111','hard-owner@example.test'),
 ('f1222222-2222-4222-8222-222222222222','hard-director@example.test'),
 ('f1333333-3333-4333-8333-333333333333','hard-evaluator@example.test');
insert into public.organizations(id,name,slug) values
 ('f1000000-0000-4000-8000-000000000001','Evaluation hardening','evaluation-hardening');
insert into public.organization_members(organization_id,user_id,role,status) values
 ('f1000000-0000-4000-8000-000000000001','f1111111-1111-4111-8111-111111111111','owner','active'),
 ('f1000000-0000-4000-8000-000000000001','f1222222-2222-4222-8222-222222222222','member','active'),
 ('f1000000-0000-4000-8000-000000000001','f1333333-3333-4333-8333-333333333333','member','active');
insert into public.tryouts(id,organization_id,name,slug,sport,timezone) values
 ('f1666666-6666-4666-8666-666666666661','f1000000-0000-4000-8000-000000000001','Hardening Camp','hardening-camp','Hockey','America/Edmonton');
insert into public.tryout_divisions(id,organization_id,tryout_id,name,sort_order) values
 ('f1777777-7777-4777-8777-777777777771','f1000000-0000-4000-8000-000000000001','f1666666-6666-4666-8666-666666666661','Open',0);
insert into public.tryout_sessions(id,organization_id,tryout_id,division_id,name,starts_at,ends_at,sort_order) values
 ('f1888888-8888-4888-8888-888888888881','f1000000-0000-4000-8000-000000000001','f1666666-6666-4666-8666-666666666661','f1777777-7777-4777-8777-777777777771','Skills',clock_timestamp()+interval '1 day',clock_timestamp()+interval '1 day 1 hour',0);
insert into public.session_groups(id,organization_id,tryout_id,session_id,name,capacity,sort_order) values
 ('f1999999-9999-4999-8999-999999999991','f1000000-0000-4000-8000-000000000001','f1666666-6666-4666-8666-666666666661','f1888888-8888-4888-8888-888888888881','Blue',20,0);
insert into public.tryout_staff_assignments(organization_id,user_id,role,scope_kind,tryout_id,session_id,group_id,granted_by_user_id) values
 ('f1000000-0000-4000-8000-000000000001','f1222222-2222-4222-8222-222222222222','director','group','f1666666-6666-4666-8666-666666666661','f1888888-8888-4888-8888-888888888881','f1999999-9999-4999-8999-999999999991','f1111111-1111-4111-8111-111111111111'),
 ('f1000000-0000-4000-8000-000000000001','f1333333-3333-4333-8333-333333333333','evaluator','group','f1666666-6666-4666-8666-666666666661','f1888888-8888-4888-8888-888888888881','f1999999-9999-4999-8999-999999999991','f1111111-1111-4111-8111-111111111111');
insert into public.registration_forms(id,organization_id,tryout_id,name) values
 ('f1000000-0000-4000-8000-000000000011','f1000000-0000-4000-8000-000000000001','f1666666-6666-4666-8666-666666666661','Form');
insert into public.registration_form_versions(id,organization_id,tryout_id,registration_form_id,version_number,schema,status,published_at) values
 ('f1000000-0000-4000-8000-000000000012','f1000000-0000-4000-8000-000000000001','f1666666-6666-4666-8666-666666666661','f1000000-0000-4000-8000-000000000011',1,'{"fields":[]}','published',clock_timestamp());
insert into public.athletes(id,organization_id,given_name,family_name,normalized_given_name,normalized_family_name,birth_date) values
 ('f1000000-0000-4000-8000-000000000013','f1000000-0000-4000-8000-000000000001','Test','Athlete','test','athlete','2012-01-01');
insert into public.tryout_registrations(id,organization_id,tryout_id,athlete_id,division_id,registration_form_version_id,responses,submission_key_digest,submission_digest) values
 ('f1000000-0000-4000-8000-000000000014','f1000000-0000-4000-8000-000000000001','f1666666-6666-4666-8666-666666666661','f1000000-0000-4000-8000-000000000013','f1777777-7777-4777-8777-777777777771','f1000000-0000-4000-8000-000000000012','{}',repeat('f',64),repeat('6',64));
insert into public.session_enrollments(organization_id,tryout_id,registration_id,session_id,group_id) values
 ('f1000000-0000-4000-8000-000000000001','f1666666-6666-4666-8666-666666666661','f1000000-0000-4000-8000-000000000014','f1888888-8888-4888-8888-888888888881','f1999999-9999-4999-8999-999999999991');
insert into public.rubrics(id,organization_id,tryout_id,name) values
 ('f1000000-0000-4000-8000-000000000021','f1000000-0000-4000-8000-000000000001','f1666666-6666-4666-8666-666666666661','Skills');
insert into public.rubric_versions(id,organization_id,tryout_id,rubric_id,version_number) values
 ('f1000000-0000-4000-8000-000000000022','f1000000-0000-4000-8000-000000000001','f1666666-6666-4666-8666-666666666661','f1000000-0000-4000-8000-000000000021',1);
insert into public.rubric_categories(id,organization_id,tryout_id,rubric_version_id,name,sort_order,weight,scale_min,scale_max) values
 ('f1000000-0000-4000-8000-000000000023','f1000000-0000-4000-8000-000000000001','f1666666-6666-4666-8666-666666666661','f1000000-0000-4000-8000-000000000022','Skating',0,100,1,5);
insert into public.session_rubrics(organization_id,tryout_id,session_id,rubric_version_id) values
 ('f1000000-0000-4000-8000-000000000001','f1666666-6666-4666-8666-666666666661','f1888888-8888-4888-8888-888888888881','f1000000-0000-4000-8000-000000000022');
set session_replication_role=replica;
update public.rubric_versions set status='published',published_at=clock_timestamp() where id='f1000000-0000-4000-8000-000000000022';
update public.tryouts set status='published',published_at=clock_timestamp() where id='f1666666-6666-4666-8666-666666666661';
set session_replication_role=origin;
insert into public.organization_evaluation_note_tags(id,organization_id,label) values
 ('f1000000-0000-4000-8000-000000000031','f1000000-0000-4000-8000-000000000001','High motor');

select ok(has_function_privilege('authenticated','public.save_evaluation_draft(uuid,uuid,uuid,uuid,uuid,uuid,uuid,integer,jsonb,text,uuid[],text[])','execute'),'full-placement draft command is exposed');
select ok(to_regprocedure('public.save_evaluation_draft(uuid,uuid,uuid,uuid,uuid,integer,jsonb,text,uuid[],text[])') is null,'legacy partial-placement draft command is absent');
select ok(has_function_privilege('authenticated','public.lock_evaluation(uuid,uuid,uuid,uuid,uuid,uuid,integer)','execute'),'guarded lock command is exposed');
select ok(has_function_privilege('authenticated','public.manage_director_evaluation_flag(uuid,uuid,uuid,uuid,uuid,uuid,uuid,text,text)','execute'),'guarded director flag command is exposed');
select ok(not has_table_privilege('service_role','public.evaluations','update'),'service role cannot directly update evaluations');
select ok(not has_table_privilege('service_role','public.athlete_flags','insert'),'service role cannot directly insert flags');
select ok(not has_table_privilege('authenticated','private.evaluation_write_permits','select'),'authenticated cannot inspect trusted write permits');

set local role authenticated;
select set_config('request.jwt.claim.sub','f1333333-3333-4333-8333-333333333333',true);
select is((select outcome from public.save_evaluation_draft(
 'f1000000-0000-4000-8000-000000000001','f1666666-6666-4666-8666-666666666661','f1777777-7777-4777-8777-777777777771',
 'f1000000-0000-4000-8000-000000000014','f1888888-8888-4888-8888-888888888881','f1999999-9999-4999-8999-999999999991',
 'f1000000-0000-4000-8000-000000000022',0,'[{"categoryId":"f1000000-0000-4000-8000-000000000023","value":4}]','private',
 array['f1000000-0000-4000-8000-000000000031']::uuid[],array['needs_another_look']::text[])),'saved','exact-placement evaluator creates a draft');
select set_config('app.test.hardened_evaluation',(select id::text from public.evaluations where organization_id='f1000000-0000-4000-8000-000000000001'),true);
select is((select division_id from public.evaluations where id=current_setting('app.test.hardened_evaluation')::uuid),'f1777777-7777-4777-8777-777777777771'::uuid,'evaluation snapshots authoritative division');
select is((select group_id from public.evaluations where id=current_setting('app.test.hardened_evaluation')::uuid),'f1999999-9999-4999-8999-999999999991'::uuid,'evaluation snapshots authoritative group');
select is((select outcome from public.save_evaluation_draft(
 'f1000000-0000-4000-8000-000000000001','f1666666-6666-4666-8666-666666666661','f1777777-7777-4777-8777-777777777799',
 'f1000000-0000-4000-8000-000000000014','f1888888-8888-4888-8888-888888888881','f1999999-9999-4999-8999-999999999991',
 'f1000000-0000-4000-8000-000000000022',1,'[]',null,array[]::uuid[],array[]::text[])),'forbidden','caller-supplied unrelated division is denied by authoritative database placement');
select is((select outcome from public.complete_evaluation(
 'f1000000-0000-4000-8000-000000000001','f1666666-6666-4666-8666-666666666661','f1777777-7777-4777-8777-777777777771',
 'f1888888-8888-4888-8888-888888888881','f1999999-9999-4999-8999-999999999991',current_setting('app.test.hardened_evaluation')::uuid,1)),'completed','draft completes through exact placement CAS');

reset role;
select throws_ok($$update public.evaluations set state='reopened',version=version+1 where id=current_setting('app.test.hardened_evaluation')::uuid$$,'P0001','evaluation writes require trusted command','direct privileged state mutation is rejected');
select throws_ok($$update public.evaluations set version=version+1 where id=current_setting('app.test.hardened_evaluation')::uuid$$,'P0001','evaluation writes require trusted command','direct privileged version mutation is rejected');
select throws_ok($$update public.evaluations set updated_at=clock_timestamp() where id=current_setting('app.test.hardened_evaluation')::uuid$$,'P0001','evaluation writes require trusted command','direct privileged timestamp mutation is rejected');
select throws_ok($$update public.evaluations set tryout_session_id='f1888888-8888-4888-8888-888888888899' where id=current_setting('app.test.hardened_evaluation')::uuid$$,'P0001','evaluation writes require trusted command','direct privileged context mutation is rejected');
select throws_ok($$delete from public.evaluations where id=current_setting('app.test.hardened_evaluation')::uuid$$,'P0001','evaluation writes require trusted command','direct privileged evaluation deletion is rejected');
select throws_ok($$insert into public.evaluations(organization_id,tryout_id,division_id,tryout_registration_id,tryout_session_id,group_id,evaluator_user_id,rubric_version_id) values('f1000000-0000-4000-8000-000000000001','f1666666-6666-4666-8666-666666666661','f1777777-7777-4777-8777-777777777771','f1000000-0000-4000-8000-000000000014','f1888888-8888-4888-8888-888888888881','f1999999-9999-4999-8999-999999999991','f1333333-3333-4333-8333-333333333333','f1000000-0000-4000-8000-000000000022')$$,'P0001','evaluation writes require trusted command','direct privileged evaluation insertion is rejected');
select throws_ok($$update public.evaluation_scores set value=5 where evaluation_id=current_setting('app.test.hardened_evaluation')::uuid$$,'55000','completed evaluation children are immutable','completed score update is rejected');
select throws_ok($$delete from public.evaluation_notes where evaluation_id=current_setting('app.test.hardened_evaluation')::uuid$$,'55000','completed evaluation children are immutable','completed note delete is rejected');
select throws_ok($$insert into public.evaluation_note_tags(organization_id,evaluation_id,note_tag_id,evaluator_user_id) values('f1000000-0000-4000-8000-000000000001',current_setting('app.test.hardened_evaluation')::uuid,'f1000000-0000-4000-8000-000000000031','f1333333-3333-4333-8333-333333333333')$$,'55000','completed evaluation children are immutable','completed tag insert is rejected');
select throws_ok($$delete from public.athlete_flags where evaluation_id=current_setting('app.test.hardened_evaluation')::uuid$$,'55000','completed evaluation children are immutable','completed evaluator flag delete is rejected');
select throws_ok($$insert into public.organization_evaluation_note_tags(organization_id,label) values('f1000000-0000-4000-8000-000000000001','  padded  ')$$,'23514',null,'storage rejects non-canonical padded tag labels');

set local role authenticated;
select set_config('request.jwt.claim.sub','f1222222-2222-4222-8222-222222222222',true);
select is((select outcome from public.lock_evaluation(
 'f1000000-0000-4000-8000-000000000001','f1666666-6666-4666-8666-666666666661','f1777777-7777-4777-8777-777777777771',
 'f1888888-8888-4888-8888-888888888881','f1999999-9999-4999-8999-999999999991',current_setting('app.test.hardened_evaluation')::uuid,2)),'locked','exact-scope director locks a completed evaluation');
select is((select outcome from public.reopen_evaluation(
 'f1000000-0000-4000-8000-000000000001','f1666666-6666-4666-8666-666666666661','f1777777-7777-4777-8777-777777777771',
 'f1888888-8888-4888-8888-888888888881','f1999999-9999-4999-8999-999999999991',current_setting('app.test.hardened_evaluation')::uuid,3,'Video review requires revision')),'reopened','locked evaluation can be reopened by exact-scope director');
select is((select outcome from public.manage_director_evaluation_flag(
 'f1000000-0000-4000-8000-000000000001','f1666666-6666-4666-8666-666666666661','f1777777-7777-4777-8777-777777777771',
 'f1000000-0000-4000-8000-000000000014','f1888888-8888-4888-8888-888888888881','f1999999-9999-4999-8999-999999999999',null,'upsert','eligibility_review')),'forbidden','known unrelated group cannot receive a director flag');
select is((select outcome from public.manage_director_evaluation_flag(
 'f1000000-0000-4000-8000-000000000001','f1666666-6666-4666-8666-666666666661','f1777777-7777-4777-8777-777777777771',
 'f1000000-0000-4000-8000-000000000014','f1888888-8888-4888-8888-888888888881','f1999999-9999-4999-8999-999999999991',null,'upsert','eligibility_review')),'saved','director creates an independent attributed flag');
select set_config('app.test.director_flag',(select id::text from public.athlete_flags where creator_kind='director' and creator_user_id='f1222222-2222-4222-8222-222222222222'),true);
select is((select count(*) from public.evaluation_notes),0::bigint,'director flag authority does not reveal evaluator notes');
select is((select count(*) from public.evaluation_scores),0::bigint,'director flag authority does not reveal evaluator scores');
select is((select creator_kind from public.athlete_flags where id=current_setting('app.test.director_flag')::uuid),'director','director flag stores creator kind');
select set_config('request.jwt.claim.sub','f1111111-1111-4111-8111-111111111111',true);
select is((select outcome from public.manage_director_evaluation_flag(
 'f1000000-0000-4000-8000-000000000001','f1666666-6666-4666-8666-666666666661','f1777777-7777-4777-8777-777777777771',
 'f1000000-0000-4000-8000-000000000014','f1888888-8888-4888-8888-888888888881','f1999999-9999-4999-8999-999999999991',current_setting('app.test.director_flag')::uuid,'upsert','needs_another_look')),'saved','organization owner may update an exact-context director flag without evaluation visibility');
select set_config('request.jwt.claim.sub','f1222222-2222-4222-8222-222222222222',true);
select is((select outcome from public.manage_director_evaluation_flag(
 'f1000000-0000-4000-8000-000000000001','f1666666-6666-4666-8666-666666666661','f1777777-7777-4777-8777-777777777771',
 'f1000000-0000-4000-8000-000000000014','f1888888-8888-4888-8888-888888888881','f1999999-9999-4999-8999-999999999991',current_setting('app.test.director_flag')::uuid,'revoke','needs_another_look')),'revoked','exact-scope director can revoke attributed director flag');
reset role;
select is((select count(*) from public.audit_logs where entity_id=current_setting('app.test.hardened_evaluation')::uuid and action in ('evaluation.locked','evaluation.reopened')),2::bigint,'lock and reopen transitions are audited');
select is((select count(*) from public.audit_logs where entity_id=current_setting('app.test.director_flag')::uuid and action in ('evaluation.director_flag_saved','evaluation.director_flag_revoked')),3::bigint,'director flag changes by every manager are audited');

set local role authenticated;
select set_config('request.jwt.claim.sub','f1333333-3333-4333-8333-333333333333',true);
select is((select outcome from public.save_evaluation_draft(
 'f1000000-0000-4000-8000-000000000001','f1666666-6666-4666-8666-666666666661','f1777777-7777-4777-8777-777777777771',
 'f1000000-0000-4000-8000-000000000014','f1888888-8888-4888-8888-888888888881','f1999999-9999-4999-8999-999999999991',
 'f1000000-0000-4000-8000-000000000022',4,'[{"categoryId":"f1000000-0000-4000-8000-000000000023","value":5}]','revised',array[]::uuid[],array[]::text[])),'saved','reopened evaluation is editable');
select is((select state from public.evaluations where id=current_setting('app.test.hardened_evaluation')::uuid),'reopened','draft save preserves reopened state');

reset role;
select * from finish();
rollback;
