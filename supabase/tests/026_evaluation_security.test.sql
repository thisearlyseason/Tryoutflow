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

select ok(has_function_privilege('authenticated','public.save_evaluation_draft(uuid,uuid,uuid,uuid,uuid,uuid,uuid,integer,jsonb,text,uuid[],text[])','execute'),'authenticated can invoke guarded draft command');
select ok(not has_function_privilege('anon','public.save_evaluation_draft(uuid,uuid,uuid,uuid,uuid,uuid,uuid,integer,jsonb,text,uuid[],text[])','execute'),'anonymous cannot save evaluations');
select ok(not has_function_privilege('service_role','public.reopen_evaluation(uuid,uuid,uuid,uuid,uuid,uuid,integer,text)','execute'),'service role cannot bypass reopen authorization');
select ok(not has_table_privilege('authenticated','public.evaluations','insert'),'authenticated cannot directly insert evaluations');
select ok(not has_table_privilege('authenticated','public.evaluation_scores','update'),'authenticated cannot directly update scores');
select ok(not has_table_privilege('service_role','public.evaluation_notes','select'),'service role cannot bypass private note ACL');
select ok(not has_table_privilege('authenticated','public.evaluations','truncate'),'authenticated cannot truncate evaluations');
select ok(not has_table_privilege('authenticated','public.evaluation_scores','maintain'),'authenticated cannot maintain score storage');
select ok(not has_function_privilege('authenticated','public.evaluator_has_active_context(uuid,uuid,uuid,uuid,uuid)','execute'),'internal context helper is not exposed');
select ok(not has_function_privilege('authenticated','public.lock_evaluator_context(uuid,uuid,uuid,uuid,uuid,uuid,uuid)','execute'),'internal mutation lock helper is not exposed');
select ok(not has_function_privilege('authenticated','public.lock_manager_evaluation_context(uuid,uuid,uuid,uuid,uuid,uuid)','execute'),'internal manager lock helper is not exposed');
select ok(has_function_privilege('authenticated','public.can_select_own_evaluation(uuid)','execute'),'authenticated receives only the safe own-row RLS predicate');
select ok(not has_function_privilege('anon','public.can_select_own_evaluation(uuid)','execute'),'anonymous cannot probe the own-row RLS predicate');
select ok(has_function_privilege('authenticated','public.configure_evaluation_note_tag(uuid,uuid,text,boolean)','execute'),'authenticated may invoke guarded note-tag configuration');
select ok(not has_function_privilege('service_role','public.configure_evaluation_note_tag(uuid,uuid,text,boolean)','execute'),'service role cannot bypass note-tag configuration authorization');

set local role authenticated;
select set_config('request.jwt.claim.sub','e1333333-3333-4333-8333-333333333333',true);
select is((select outcome from public.save_evaluation_draft('e1000000-0000-4000-8000-000000000001','e1666666-6666-4666-8666-666666666661','e1777777-7777-4777-8777-777777777771','e1000000-0000-4000-8000-000000000014','e1888888-8888-4888-8888-888888888881',null,'e1000000-0000-4000-8000-000000000022',0,'[{"categoryId":"e1000000-0000-4000-8000-000000000023","value":4}]','private note',array['e1000000-0000-4000-8000-000000000031']::uuid[],array['needs_another_look']::text[])),'saved','assigned evaluator creates own draft');
select set_config('app.test.evaluation_a',(select id::text from public.evaluations where evaluator_user_id='e1333333-3333-4333-8333-333333333333'),true);
select is((select count(*) from public.evaluations),1::bigint,'evaluator reads own evaluation only');
select is((select count(*) from public.evaluation_notes where evaluation_id=current_setting('app.test.evaluation_a')::uuid),1::bigint,'evaluator reads own private note');
select is((select count(*) from public.evaluation_note_tags where evaluation_id=current_setting('app.test.evaluation_a')::uuid),1::bigint,'configured quick tag is linked to exact own evaluation');
select is((select count(*) from public.athlete_flags where evaluation_id=current_setting('app.test.evaluation_a')::uuid),1::bigint,'allow-listed flag is linked to exact own evaluation');
select is((select outcome from public.complete_evaluation('e1000000-0000-4000-8000-000000000001','e1666666-6666-4666-8666-666666666661','e1777777-7777-4777-8777-777777777771','e1888888-8888-4888-8888-888888888881',null,current_setting('app.test.evaluation_a')::uuid,1)),'required_scores_missing','completion never invents a missing score');
select is((select outcome from public.save_evaluation_draft('e1000000-0000-4000-8000-000000000001','e1666666-6666-4666-8666-666666666661','e1777777-7777-4777-8777-777777777771','e1000000-0000-4000-8000-000000000014','e1888888-8888-4888-8888-888888888881',null,'e1000000-0000-4000-8000-000000000022',1,'[{"categoryId":"e1000000-0000-4000-8000-000000000023","value":5},{"categoryId":"e1000000-0000-4000-8000-000000000024","value":10}]',null,array[]::uuid[],array[]::text[])),'saved','CAS replaces the entire evaluator-owned draft');
select is((select outcome from public.complete_evaluation('e1000000-0000-4000-8000-000000000001','e1666666-6666-4666-8666-666666666661','e1777777-7777-4777-8777-777777777771','e1888888-8888-4888-8888-888888888881',null,current_setting('app.test.evaluation_a')::uuid,null)),'conflict','null expected version cannot bypass completion CAS');
select is((select outcome from public.complete_evaluation('e1000000-0000-4000-8000-000000000001','e1666666-6666-4666-8666-666666666661','e1777777-7777-4777-8777-777777777771','e1888888-8888-4888-8888-888888888881',null,current_setting('app.test.evaluation_a')::uuid,2)),'completed','valid required scores complete atomically');
select is((select version from public.evaluations where id=current_setting('app.test.evaluation_a')::uuid),3,'completion increments version');
select is((select outcome from public.save_evaluation_draft('e1000000-0000-4000-8000-000000000001','e1666666-6666-4666-8666-666666666661','e1777777-7777-4777-8777-777777777771','e1000000-0000-4000-8000-000000000014','e1888888-8888-4888-8888-888888888881',null,'e1000000-0000-4000-8000-000000000022',3,'[]',null,array[]::uuid[],array[]::text[])),'locked','completed record is immutable to evaluator');
select is((select outcome from public.save_evaluation_draft('e1000000-0000-4000-8000-000000000001','e1666666-6666-4666-8666-666666666661','e1777777-7777-4777-8777-777777777771','e1000000-0000-4000-8000-000000000014','e1888888-8888-4888-8888-888888888881',null,'e1000000-0000-4000-8000-000000000022',3,'[{"categoryId":"e1000000-0000-4000-8000-000000000099","value":4}]',null,array[]::uuid[],array[]::text[])),'locked','lock state is checked before any replacement');

select set_config('request.jwt.claim.sub','e1444444-4444-4444-8444-444444444444',true);
select is((select count(*) from public.evaluations),0::bigint,'peer evaluator cannot read known evaluation row');
select is((select count(*) from public.evaluation_scores where evaluation_id=current_setting('app.test.evaluation_a')::uuid),0::bigint,'peer evaluator cannot read scores by known UUID');
select is((select count(*) from public.evaluation_notes where evaluation_id=current_setting('app.test.evaluation_a')::uuid),0::bigint,'peer evaluator cannot read private notes');
select is((select count(*) from public.evaluation_note_tags where evaluation_id=current_setting('app.test.evaluation_a')::uuid),0::bigint,'peer evaluator cannot read note tags');
select is((select count(*) from public.athlete_flags where evaluation_id=current_setting('app.test.evaluation_a')::uuid),0::bigint,'peer evaluator cannot read flags');
select is((select outcome from public.save_evaluation_draft('e1000000-0000-4000-8000-000000000001','e1666666-6666-4666-8666-666666666661','e1777777-7777-4777-8777-777777777771','e1000000-0000-4000-8000-000000000014','e1888888-8888-4888-8888-888888888881',null,'e1000000-0000-4000-8000-000000000099',0,'[]',null,array[]::uuid[],array[]::text[])),'invalid_context','unbound rubric version is rejected');
select is((select outcome from public.save_evaluation_draft('e1000000-0000-4000-8000-000000000001','e1666666-6666-4666-8666-666666666661','e1777777-7777-4777-8777-777777777771','e1000000-0000-4000-8000-000000000099','e1888888-8888-4888-8888-888888888881',null,'e1000000-0000-4000-8000-000000000022',0,'[]',null,array[]::uuid[],array[]::text[])),'forbidden','known wrong registration UUID is denied without disclosure');
select is((select outcome from public.save_evaluation_draft('e1000000-0000-4000-8000-000000000001','e1666666-6666-4666-8666-666666666661','e1777777-7777-4777-8777-777777777771','e1000000-0000-4000-8000-000000000014','e1888888-8888-4888-8888-888888888899',null,'e1000000-0000-4000-8000-000000000022',0,'[]',null,array[]::uuid[],array[]::text[])),'forbidden','known wrong session UUID is denied without disclosure');
select is((select outcome from public.save_evaluation_draft('e1000000-0000-4000-8000-000000000001','e1666666-6666-4666-8666-666666666661','e1777777-7777-4777-8777-777777777771','e1000000-0000-4000-8000-000000000014','e1888888-8888-4888-8888-888888888881',null,'e1000000-0000-4000-8000-000000000022',0,'[{"categoryId":"e1000000-0000-4000-8000-000000000099","value":4}]',null,array[]::uuid[],array[]::text[])),'invalid_score','wrong category is rejected before row creation');
select is((select outcome from public.save_evaluation_draft('e1000000-0000-4000-8000-000000000001','e1666666-6666-4666-8666-666666666661','e1777777-7777-4777-8777-777777777771','e1000000-0000-4000-8000-000000000014','e1888888-8888-4888-8888-888888888881',null,'e1000000-0000-4000-8000-000000000022',0,'[{"categoryId":"e1000000-0000-4000-8000-000000000023","value":6}]',null,array[]::uuid[],array[]::text[])),'invalid_score','out-of-range score is rejected');
select is((select outcome from public.save_evaluation_draft('e1000000-0000-4000-8000-000000000001','e1666666-6666-4666-8666-666666666661','e1777777-7777-4777-8777-777777777771','e1000000-0000-4000-8000-000000000014','e1888888-8888-4888-8888-888888888881',null,'e1000000-0000-4000-8000-000000000022',0,'[{"categoryId":"e1000000-0000-4000-8000-000000000023","value":4},{"categoryId":"e1000000-0000-4000-8000-000000000023","value":5}]',null,array[]::uuid[],array[]::text[])),'invalid_score','duplicate category cannot address one score twice');
select is((select outcome from public.save_evaluation_draft('e1000000-0000-4000-8000-000000000001','e1666666-6666-4666-8666-666666666661','e1777777-7777-4777-8777-777777777771','e1000000-0000-4000-8000-000000000014','e1888888-8888-4888-8888-888888888881',null,'e1000000-0000-4000-8000-000000000022',0,'[]',null,array['e1000000-0000-4000-8000-000000000099']::uuid[],array[]::text[])),'invalid_note_tag','unknown note tag is rejected');
select is((select outcome from public.reopen_evaluation('e1000000-0000-4000-8000-000000000001','e1666666-6666-4666-8666-666666666661','e1777777-7777-4777-8777-777777777771','e1888888-8888-4888-8888-888888888881',null,current_setting('app.test.evaluation_a')::uuid,3,'Evaluator may not reopen')),'forbidden','evaluator cannot reopen own completion');

select set_config('request.jwt.claim.sub','e1222222-2222-4222-8222-222222222222',true);
select is((select outcome from public.reopen_evaluation('e1000000-0000-4000-8000-000000000001','e1666666-6666-4666-8666-666666666661','e1777777-7777-4777-8777-777777777771','e1888888-8888-4888-8888-888888888881',null,current_setting('app.test.evaluation_a')::uuid,3,'short')),'invalid_reason','director must provide bounded reason');
select is((select outcome from public.reopen_evaluation('e1000000-0000-4000-8000-000000000001','e1666666-6666-4666-8666-666666666661','e1777777-7777-4777-8777-777777777771','e1888888-8888-4888-8888-888888888881',null,current_setting('app.test.evaluation_a')::uuid,3,'Review requested after video replay')),'reopened','exact session director reopens completion');
reset role;
select is((select count(*) from public.audit_logs where action='evaluation.reopened' and entity_id=current_setting('app.test.evaluation_a')::uuid and details->>'beforeState'='completed' and details->>'afterState'='reopened'),1::bigint,'reopen records before and after state in append-only audit');

set local role authenticated;
select set_config('request.jwt.claim.sub','e1333333-3333-4333-8333-333333333333',true);
select is((select outcome from public.save_evaluation_draft('e1000000-0000-4000-8000-000000000001','e1666666-6666-4666-8666-666666666661','e1777777-7777-4777-8777-777777777771','e1000000-0000-4000-8000-000000000014','e1888888-8888-4888-8888-888888888881',null,'e1000000-0000-4000-8000-000000000022',4,'[{"categoryId":"e1000000-0000-4000-8000-000000000023","value":3},{"categoryId":"e1000000-0000-4000-8000-000000000024","value":8}]','revised',array[]::uuid[],array[]::text[])),'saved','owner evaluator edits own reopened record');
select is((select outcome from public.complete_evaluation('e1000000-0000-4000-8000-000000000001','e1666666-6666-4666-8666-666666666661','e1777777-7777-4777-8777-777777777771','e1888888-8888-4888-8888-888888888881',null,current_setting('app.test.evaluation_a')::uuid,4)),'conflict','stale completion loses CAS race');
reset role;
select throws_ok(
  $$update public.evaluation_scores set value=99 where evaluation_id=current_setting('app.test.evaluation_a')::uuid$$,
  '23514',null,'database trigger independently enforces exact category scale');

set local role authenticated;
select set_config('request.jwt.claim.sub','e1111111-1111-4111-8111-111111111111',true);
select is((select outcome from public.configure_evaluation_note_tag('e1000000-0000-4000-8000-000000000001',null,'High motor',true)),'saved','owner safely configures an organization note tag');
select is((select outcome from public.configure_evaluation_note_tag('e1000000-0000-4000-8000-000000000001',null,'high MOTOR',true)),'conflict','canonical note-tag label uniqueness prevents confusing duplicates');
select set_config('request.jwt.claim.sub','e1333333-3333-4333-8333-333333333333',true);
select is((select outcome from public.configure_evaluation_note_tag('e1000000-0000-4000-8000-000000000001',null,'Unauthorized tag',true)),'forbidden','evaluator cannot configure organization note tags');

select set_config('request.jwt.claim.sub','e1555555-5555-4555-8555-555555555555',true);
select is((select outcome from public.save_evaluation_draft('e1000000-0000-4000-8000-000000000001','e1666666-6666-4666-8666-666666666661','e1777777-7777-4777-8777-777777777771','e1000000-0000-4000-8000-000000000014','e1888888-8888-4888-8888-888888888881',null,'e1000000-0000-4000-8000-000000000022',0,'[]',null,array[]::uuid[],array[]::text[])),'forbidden','cross-tenant known UUID attack is denied');

reset role;
update public.organization_members set status='disabled' where organization_id='e1000000-0000-4000-8000-000000000001' and user_id='e1333333-3333-4333-8333-333333333333';
set local role authenticated;
select set_config('request.jwt.claim.sub','e1333333-3333-4333-8333-333333333333',true);
select is((select count(*) from public.evaluations),0::bigint,'offboarded evaluator immediately loses historical evaluation reads');
select is((select outcome from public.complete_evaluation('e1000000-0000-4000-8000-000000000001','e1666666-6666-4666-8666-666666666661','e1777777-7777-4777-8777-777777777771','e1888888-8888-4888-8888-888888888881',null,current_setting('app.test.evaluation_a')::uuid,5)),'forbidden','offboarded evaluator cannot mutate historical evaluation');
reset role;
select * from finish();
rollback;
