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
update public.rubric_versions set status='published',published_at=clock_timestamp() where id='e8000000-0000-4000-8000-000000000022';
update public.tryouts set status='published',published_at=clock_timestamp() where id='e8666666-6666-4666-8666-666666666661';

insert into auth.users(id) values('e8999999-9999-4999-8999-999999999999');
select set_config('test.setup.original',(select to_jsonb(t)::text from public.tryouts t where id='e8666666-6666-4666-8666-666666666661'),true);
select set_config('test.setup.registration',(select to_jsonb(t)::text from public.tryout_registrations t where id='e8000000-0000-4000-8000-000000000014'),true);
select set_config('test.setup.form',(select to_jsonb(t)::text from public.registration_form_versions t where id='e8000000-0000-4000-8000-000000000012'),true);
select set_config('test.setup.category',(select to_jsonb(t)::text from public.rubric_categories t where id='e8000000-0000-4000-8000-000000000023'),true);
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','e8333333-3333-4333-8333-333333333333',true);
select is((select outcome from public.save_evaluation_draft('e8000000-0000-4000-8000-000000000001','e8666666-6666-4666-8666-666666666661','e8777777-7777-4777-8777-777777777771','e8000000-0000-4000-8000-000000000014','e8888888-8888-4888-8888-888888888881',null,'e8000000-0000-4000-8000-000000000022',0,'[{"categoryId":"e8000000-0000-4000-8000-000000000023","value":4}]')),'saved','an evaluator starts a scorecard before rubric revision');
reset role;
select set_config('test.setup.evaluation',(select to_jsonb(t)::text from public.evaluations t where tryout_registration_id='e8000000-0000-4000-8000-000000000014'),true);
select set_config('test.setup.score',(select to_jsonb(t)::text from public.evaluation_scores t where rubric_version_id='e8000000-0000-4000-8000-000000000022'),true);
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','e8111111-1111-4111-8111-111111111111',true);
select is((select outcome from public.save_tryout_wizard_configuration('e8000000-0000-4000-8000-000000000001','e8666666-6666-4666-8666-666666666661','basics','{"name": "Edited camp", "sport": "Hockey", "timezone": "America/Edmonton", "registrationStartsAt": "2026-09-01T08:00", "registrationEndsAt": "2026-09-30T20:00"}')),'saved','published basics edit same tryout');
select is((select outcome from public.save_tryout_wizard_configuration('e8000000-0000-4000-8000-000000000001','e8666666-6666-4666-8666-666666666661','divisions','{"divisionId": "e8777777-7777-4777-8777-777777777771", "name": "Edited division", "minAge": 12, "maxAge": 15, "description": "Division details"}')),'saved','published division edits metadata');
select is((select outcome from public.save_tryout_wizard_configuration('e8000000-0000-4000-8000-000000000001','e8666666-6666-4666-8666-666666666661','sessions','{"sessionId": "e8888888-8888-4888-8888-888888888881", "divisionId": "e8777777-7777-4777-8777-777777777771", "name": "Edited session", "startsAt": "2026-10-01T10:00", "endsAt": "2026-10-01T12:00", "location": "Arena", "capacity": 30}')),'saved','published session edits metadata');
select is((select outcome from public.save_tryout_wizard_configuration('e8000000-0000-4000-8000-000000000001','e8666666-6666-4666-8666-666666666661','rubrics','{"sessionId": "e8888888-8888-4888-8888-888888888881", "name": "Skills", "categories": [{"name": "New skating", "weight": 60, "scaleMin": 1, "scaleMax": 10, "description": "Skills", "guidance": "Observe", "isPriority": true}, {"name": "Effort", "weight": 40, "scaleMin": 1, "scaleMax": 5}]}')),'saved','published rubric creates a new version');
select is((select outcome from public.save_tryout_wizard_configuration('e8000000-0000-4000-8000-000000000001','e8666666-6666-4666-8666-666666666661','registration','{"name": "Form", "schema": {"fields": []}}')),'saved','published registration selects a revision');
reset role;
select is((select status from public.tryouts where id='e8666666-6666-4666-8666-666666666661'),'published','metadata save preserves published lifecycle');
select is((select published_at from public.tryouts where id='e8666666-6666-4666-8666-666666666661'),(current_setting('test.setup.original')::jsonb->>'published_at')::timestamptz,'publication timestamp is preserved');
select is((select slug from public.tryouts where id='e8666666-6666-4666-8666-666666666661'),'sync-camp','public slug is preserved');
select is((select version from public.tryouts where id='e8666666-6666-4666-8666-666666666661'),(current_setting('test.setup.original')::jsonb->>'version')::integer+5,'every save increments the serialized parent version once');
select is((select to_jsonb(t) from public.tryout_registrations t where id='e8000000-0000-4000-8000-000000000014'),current_setting('test.setup.registration')::jsonb,'tryout_registrations history remains byte identical after setup edits');
select is((select to_jsonb(t) from public.registration_form_versions t where id='e8000000-0000-4000-8000-000000000012'),current_setting('test.setup.form')::jsonb,'registration_form_versions history remains byte identical after setup edits');
select is((select to_jsonb(t) from public.rubric_categories t where id='e8000000-0000-4000-8000-000000000023'),current_setting('test.setup.category')::jsonb,'rubric_categories history remains byte identical after setup edits');
select is((select to_jsonb(t) from public.evaluations t where tryout_registration_id='e8000000-0000-4000-8000-000000000014'),current_setting('test.setup.evaluation')::jsonb,'evaluations history remains byte identical after setup edits');
select is((select to_jsonb(t) from public.evaluation_scores t where rubric_version_id='e8000000-0000-4000-8000-000000000022'),current_setting('test.setup.score')::jsonb,'evaluation_scores history remains byte identical after setup edits');
select isnt((select rubric_version_id from public.session_rubrics where session_id='e8888888-8888-4888-8888-888888888881'),'e8000000-0000-4000-8000-000000000022'::uuid,'new rubric becomes current selection');
select is((select count(*) from private.session_rubric_version_history where session_id='e8888888-8888-4888-8888-888888888881'),2::bigint,'both rubric provenance edges are retained');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','e8111111-1111-4111-8111-111111111111',true);
select is((public.get_tryout_setup_configuration('e8000000-0000-4000-8000-000000000001','e8666666-6666-4666-8666-666666666661')#>>'{sessions,0,rubric,categories,0,name}'),'New skating','setup read loads selected revision');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','e8333333-3333-4333-8333-333333333333',true);
select is((select outcome from public.save_evaluation_draft('e8000000-0000-4000-8000-000000000001','e8666666-6666-4666-8666-666666666661','e8777777-7777-4777-8777-777777777771','e8000000-0000-4000-8000-000000000014','e8888888-8888-4888-8888-888888888881',null,'e8000000-0000-4000-8000-000000000022',1,'[{"categoryId":"e8000000-0000-4000-8000-000000000023","value":5}]')),'saved','existing scorecard continues on its pinned rubric');
select is((select receipt->>'outcome' from public.sync_evaluation_mutation('e8000000-0000-4000-8000-000000000001','e8666666-6666-4666-8666-666666666661','e8888888-8888-4888-8888-888888888881','e8000000-0000-4000-8000-000000000014','e8000000-0000-4000-8000-000000000022',(current_setting('test.setup.evaluation')::jsonb->>'id')::uuid,'e8000000-0000-4000-8000-000000000081',2,'{"scores":[{"categoryId":"e8000000-0000-4000-8000-000000000023","value":4}],"noteTagIds":[],"flags":[]}')),'synced','offline mutation still accepts an existing pinned rubric');
select is((select outcome from public.complete_evaluation('e8000000-0000-4000-8000-000000000001','e8666666-6666-4666-8666-666666666661','e8777777-7777-4777-8777-777777777771','e8888888-8888-4888-8888-888888888881',null,(current_setting('test.setup.evaluation')::jsonb->>'id')::uuid,3)),'completed','existing scorecard completes with its pinned version');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','e8111111-1111-4111-8111-111111111111',true);
select is((select result#>>'{snapshot,registrations,0,evaluations,0,categories,0,score}' from public.load_ranking_snapshot('e8000000-0000-4000-8000-000000000001','e8666666-6666-4666-8666-666666666661')),'4','ranking still includes historical score after new selection');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','e8111111-1111-4111-8111-111111111111',true);
select is((select outcome from public.save_tryout_wizard_configuration('e8000000-0000-4000-8000-000000000001','e8666666-6666-4666-8666-666666666661','basics','{"name": "Edited camp", "sport": "Hockey", "timezone": "America/Edmonton", "registrationStartsAt": "2026-09-01T08:00", "registrationEndsAt": "2026-09-30T20:00", "expectedVersion": 0}')),'conflict','stale setup version refuses lost update');
reset role;
insert into public.tryouts(id,organization_id,name,slug,sport,timezone) values('e8000000-0000-4000-8000-000000000091','e8000000-0000-4000-8000-000000000001','Other camp','other-setup-camp','Hockey','America/Edmonton');
insert into public.tryout_divisions(id,organization_id,tryout_id,name,sort_order) values('e8000000-0000-4000-8000-000000000092','e8000000-0000-4000-8000-000000000001','e8000000-0000-4000-8000-000000000091','Other',0);
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','e8111111-1111-4111-8111-111111111111',true);
select is((select outcome from public.save_tryout_wizard_configuration('e8000000-0000-4000-8000-000000000001','e8666666-6666-4666-8666-666666666661','divisions','{"divisionId": "e8000000-0000-4000-8000-000000000092", "name": "Injected"}')),'invalid_input','foreign tryout division identity is rejected');
select is((select outcome from public.save_tryout_wizard_configuration('e8000000-0000-4000-8000-000000000001','e8666666-6666-4666-8666-666666666661','sessions','{"sessionId": "e8888888-8888-4888-8888-888888888881", "divisionId": "e8000000-0000-4000-8000-000000000092", "name": "Edited session", "startsAt": "2026-10-01T10:00", "endsAt": "2026-10-01T12:00", "location": "Arena", "capacity": 30}')),'invalid_input','existing session cannot move across division scope');
select is((select outcome from public.save_tryout_wizard_configuration('e8000000-0000-4000-8000-000000000001','e8666666-6666-4666-8666-666666666661','sessions','{"sessionId": "e8888888-8888-4888-8888-888888888881", "divisionId": "e8777777-7777-4777-8777-777777777771", "name": "Edited session", "startsAt": "2026-10-01T10:00", "endsAt": "2026-10-01T12:00", "location": "Arena", "capacity": 30, "groupId": "e8000000-0000-4000-8000-000000000092", "groupName": "Injected"}')),'invalid_input','foreign group identity is rejected before any write');
select is((select outcome from public.save_tryout_wizard_configuration('e8000000-0000-4000-8000-000000000001','e8666666-6666-4666-8666-666666666661','sessions','{"sessionId": "e8888888-8888-4888-8888-888888888881", "divisionId": "e8777777-7777-4777-8777-777777777771", "name": "Edited session", "startsAt": "2026-10-01T10:00", "endsAt": "2026-10-01T12:00", "location": "Arena", "capacity": 30, "positionId": "e8000000-0000-4000-8000-000000000092", "positionName": "Injected"}')),'invalid_input','foreign position identity is rejected');
select is((select outcome from public.save_tryout_wizard_configuration('e8000000-0000-4000-8000-000000000001','e8666666-6666-4666-8666-666666666661','rubrics','{"sessionId": "e8000000-0000-4000-8000-000000000092", "name": "Skills", "categories": [{"name": "New skating", "weight": 60, "scaleMin": 1, "scaleMax": 10, "description": "Skills", "guidance": "Observe", "isPriority": true}, {"name": "Effort", "weight": 40, "scaleMin": 1, "scaleMax": 5}]}')),'invalid_input','foreign rubric session identity is rejected');
select is((select outcome from public.save_tryout_wizard_configuration('e8000000-0000-4000-8000-000000000001','e8666666-6666-4666-8666-666666666661','rubrics','{"sessionId": "e8888888-8888-4888-8888-888888888881", "name": "Bad rubric", "categories": [{"name": "Bad", "weight": 25, "scaleMin": 1, "scaleMax": 5}]}')),'invalid_input','incomplete rubric weight rejects the whole write');
select is((select outcome from public.save_tryout_wizard_configuration('e8000000-0000-4000-8000-000000000001','e8666666-6666-4666-8666-666666666661','sessions','{"sessionId": "e8888888-8888-4888-8888-888888888881", "divisionId": "e8777777-7777-4777-8777-777777777771", "name": "Edited session", "startsAt": "2026-10-01T10:00", "endsAt": "2026-10-01T12:00", "location": "Arena", "capacity": -1}')),'invalid_input','invalid child metadata is atomic');
select is((select outcome from public.save_tryout_wizard_configuration('e8000000-0000-4000-8000-000000000001','e8666666-6666-4666-8666-666666666661','divisions','{"divisionId": "not-a-uuid", "name": "Bad"}')),'invalid_input','invalid identifier returns validation outcome');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','e8999999-9999-4999-8999-999999999999',true);
select throws_ok($$select * from public.save_tryout_wizard_configuration('e8000000-0000-4000-8000-000000000001','e8666666-6666-4666-8666-666666666661','basics','{"name": "Edited camp", "sport": "Hockey", "timezone": "America/Edmonton", "registrationStartsAt": "2026-09-01T08:00", "registrationEndsAt": "2026-09-30T20:00"}')$$,'42501',null,'outsider cannot edit setup');
select throws_ok($$select public.get_tryout_setup_configuration('e8000000-0000-4000-8000-000000000001','e8666666-6666-4666-8666-666666666661')$$,'42501',null,'outsider cannot read setup');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','e8333333-3333-4333-8333-333333333333',true);
select throws_ok($$select * from public.save_tryout_wizard_configuration('e8000000-0000-4000-8000-000000000001','e8666666-6666-4666-8666-666666666661','divisions','{"name":"Evaluator edit"}')$$,'42501',null,'evaluator cannot edit organizer setup');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','e8111111-1111-4111-8111-111111111111',true);
reset role;
select ok(not has_table_privilege('authenticated','private.tryout_configuration_commands','insert'),'caller cannot forge configuration command capability');
select ok(not has_function_privilege('authenticated','private.save_tryout_setup_configuration(uuid,uuid,text,jsonb)','execute'),'private command implementation is not callable');
select ok(not has_function_privilege('anon','public.get_tryout_setup_configuration(uuid,uuid)','execute'),'anonymous setup read is closed');
set local role authenticated;
select set_config('app.tryout_configuration_edit','true',true);
select throws_ok($$update public.tryout_divisions set name='Direct write' where id='e8777777-7777-4777-8777-777777777771'$$,'42501',null,'direct writes cannot forge authorization with a GUC');
reset role;
select throws_ok($$update public.tryout_divisions set name='Direct privileged write' where id='e8777777-7777-4777-8777-777777777771'$$,'23514',null,'trigger still denies direct published child mutation');
select throws_ok($$update public.tryouts set name='Direct privileged write' where id='e8666666-6666-4666-8666-666666666661'$$,'23514',null,'trigger still denies direct published basics mutation');
select throws_ok($$update public.session_rubrics set rubric_version_id='e8000000-0000-4000-8000-000000000022' where session_id='e8888888-8888-4888-8888-888888888881'$$,'23514',null,'trigger still denies direct binding mutation');
select is((select count(*) from private.tryout_configuration_commands),0::bigint,'command capabilities never survive the call');
update public.tryouts set status='finalized',finalized_at=clock_timestamp() where id='e8666666-6666-4666-8666-666666666661';
select set_config('test.setup.finalized',(select to_jsonb(t)::text from public.tryouts t where id='e8666666-6666-4666-8666-666666666661'),true);
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','e8111111-1111-4111-8111-111111111111',true);
select is((select outcome from public.save_tryout_wizard_configuration('e8000000-0000-4000-8000-000000000001','e8666666-6666-4666-8666-666666666661','basics','{"name": "Finalized edited camp", "sport": "Hockey", "timezone": "America/Edmonton", "registrationStartsAt": "2026-09-01T08:00", "registrationEndsAt": "2026-09-30T20:00"}')),'saved','finalized basics edit same tryout');
select is((select outcome from public.save_tryout_wizard_configuration('e8000000-0000-4000-8000-000000000001','e8666666-6666-4666-8666-666666666661','divisions','{"divisionId": "e8777777-7777-4777-8777-777777777771", "name": "Finalized division"}')),'saved','finalized division edit');
select is((select outcome from public.save_tryout_wizard_configuration('e8000000-0000-4000-8000-000000000001','e8666666-6666-4666-8666-666666666661','sessions','{"sessionId": "e8888888-8888-4888-8888-888888888881", "divisionId": "e8777777-7777-4777-8777-777777777771", "name": "Finalized session", "startsAt": "2026-10-01T10:00", "endsAt": "2026-10-01T12:00", "location": "Arena", "capacity": 30}')),'saved','finalized session edit');
select is((select outcome from public.save_tryout_wizard_configuration('e8000000-0000-4000-8000-000000000001','e8666666-6666-4666-8666-666666666661','rubrics','{"sessionId": "e8888888-8888-4888-8888-888888888881", "name": "Skills", "categories": [{"name": "Final scale", "weight": 100, "scaleMin": 1, "scaleMax": 5}]}')),'saved','finalized rubric revision');
select is((select outcome from public.save_tryout_wizard_configuration('e8000000-0000-4000-8000-000000000001','e8666666-6666-4666-8666-666666666661','registration','{"name": "Form", "schema": {"fields": []}}')),'saved','finalized registration revision');
reset role;
select is((select to_jsonb(t)-array['name','updated_at','version'] from public.tryouts t where id='e8666666-6666-4666-8666-666666666661'),current_setting('test.setup.finalized')::jsonb-array['name','updated_at','version'],'finalized lifecycle timestamps and all unrelated basics are preserved');
select is((select min_age from public.tryout_divisions where id='e8777777-7777-4777-8777-777777777771'),12,'omitted division metadata stays unchanged');
select is((select status from public.registration_form_versions v join public.tryout_registration_form_selections s on s.registration_form_version_id=v.id where s.tryout_id='e8666666-6666-4666-8666-666666666661'),'published','finalized selected form is a new published version');
select is((select count(*) from public.audit_logs where organization_id='e8000000-0000-4000-8000-000000000001' and action='tryout.configuration_saved'),10::bigint,'successful edits have an audit record each');


-- Published/finalized setup permits additions and edits without changing child identities.
set local role authenticated;
select set_config('request.jwt.claim.sub','e8111111-1111-4111-8111-111111111111',true);
select is((select outcome from public.save_tryout_wizard_configuration('e8000000-0000-4000-8000-000000000001','e8666666-6666-4666-8666-666666666661','sessions',
 '{"sessionId":"e8888888-8888-4888-8888-888888888881","divisionId":"e8777777-7777-4777-8777-777777777771","name":"Finalized session","startsAt":"2026-10-01T10:00","endsAt":"2026-10-01T12:00","groupName":"Group A","positionName":"Forward"}')),'saved','add a group and position to an existing finalized session');
select set_config('test.setup.group',(public.get_tryout_setup_configuration('e8000000-0000-4000-8000-000000000001','e8666666-6666-4666-8666-666666666661')#>>'{sessions,0,groups,0,id}'),true);
select set_config('test.setup.position',(public.get_tryout_setup_configuration('e8000000-0000-4000-8000-000000000001','e8666666-6666-4666-8666-666666666661')#>>'{positions,0,id}'),true);
select is((select outcome from public.save_tryout_wizard_configuration('e8000000-0000-4000-8000-000000000001','e8666666-6666-4666-8666-666666666661','sessions',
 jsonb_build_object('sessionId','e8888888-8888-4888-8888-888888888881','divisionId','e8777777-7777-4777-8777-777777777771','name','Finalized session','startsAt','2026-10-01T10:00','endsAt','2026-10-01T12:00','groupId',current_setting('test.setup.group'),'groupName','Group B','positionId',current_setting('test.setup.position'),'positionName','Defender'))),'saved','edit existing group and position by identity');
select is((public.get_tryout_setup_configuration('e8000000-0000-4000-8000-000000000001','e8666666-6666-4666-8666-666666666661')#>>'{sessions,0,groups,0,id}'),current_setting('test.setup.group'),'group identity survives rename');
select is((public.get_tryout_setup_configuration('e8000000-0000-4000-8000-000000000001','e8666666-6666-4666-8666-666666666661')#>>'{positions,0,name}'),'Defender','position edits reload');
select is((select result#>'{snapshot,registrations,0,categoryNames}' @> '[{"id":"e8000000-0000-4000-8000-000000000023","name":"Skating"}]' from public.load_ranking_snapshot('e8000000-0000-4000-8000-000000000001','e8666666-6666-4666-8666-666666666661')),true,'ranking filters retain historical category names');

-- Draft upserts remain publishable and can be saved repeatedly.
select is((select outcome from public.save_tryout_wizard_configuration('e8000000-0000-4000-8000-000000000001','e8000000-0000-4000-8000-000000000091','basics',
 jsonb_build_object('name','Draft edited','sport','Hockey','timezone','America/Edmonton','registrationStartsAt','2026-01-01T08:00','registrationEndsAt',to_char((clock_timestamp()+interval '30 days') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')))),'saved','draft basics retain local time support');
select is((select outcome from public.save_tryout_wizard_configuration('e8000000-0000-4000-8000-000000000001','e8000000-0000-4000-8000-000000000091','divisions',
 '{"divisionId":"e8000000-0000-4000-8000-000000000092","name":"Draft division"}')),'saved','draft division upsert edits existing row');
select is((select outcome from public.save_tryout_wizard_configuration('e8000000-0000-4000-8000-000000000001','e8000000-0000-4000-8000-000000000091','sessions',
 '{"divisionId":"e8000000-0000-4000-8000-000000000092","name":"Draft session","startsAt":"2026-10-01T10:00","endsAt":"2026-10-01T12:00"}')),'saved','draft session can be added');
select set_config('test.setup.draft_session',(public.get_tryout_setup_configuration('e8000000-0000-4000-8000-000000000001','e8000000-0000-4000-8000-000000000091')#>>'{sessions,0,id}'),true);
select is((select outcome from public.save_tryout_wizard_configuration('e8000000-0000-4000-8000-000000000001','e8000000-0000-4000-8000-000000000091','rubrics',
 jsonb_build_object('sessionId',current_setting('test.setup.draft_session'),'name','Draft skills','categoryName','Skills'))),'saved','draft rubric attaches an immutable revision');
select set_config('test.setup.first_draft_rubric',(public.get_tryout_setup_configuration('e8000000-0000-4000-8000-000000000001','e8000000-0000-4000-8000-000000000091')#>>'{sessions,0,rubric,versionId}'),true);
select is((select outcome from public.save_tryout_wizard_configuration('e8000000-0000-4000-8000-000000000001','e8000000-0000-4000-8000-000000000091','rubrics',
 jsonb_build_object('sessionId',current_setting('test.setup.draft_session'),'name','Draft skills','categoryName','Edited skills'))),'saved','draft session can select a new revision without foreign key conflicts');
select isnt((public.get_tryout_setup_configuration('e8000000-0000-4000-8000-000000000001','e8000000-0000-4000-8000-000000000091')#>>'{sessions,0,rubric,versionId}'),current_setting('test.setup.first_draft_rubric'),'draft rubric edit creates a separate immutable version');
select is((select name from public.rubric_categories where rubric_version_id=current_setting('test.setup.first_draft_rubric')::uuid),'Skills','earlier draft rubric snapshot remains unchanged');
select is((select outcome from public.save_registration_form_configuration('e8000000-0000-4000-8000-000000000001','e8000000-0000-4000-8000-000000000091',
 '{"name":"Draft form","schema":{"fields":[]},"notificationEmail":"organizer@example.test"}')),'saved','registration wrapper supports draft configuration');
select is((select count(*) from public.validate_tryout_for_publish('e8000000-0000-4000-8000-000000000001','e8000000-0000-4000-8000-000000000091')),0::bigint,'draft setup remains publish ready');
select is((select outcome from public.publish_tryout('e8000000-0000-4000-8000-000000000001','e8000000-0000-4000-8000-000000000091',(select version from public.tryouts where id='e8000000-0000-4000-8000-000000000091'))),'published','publication promotes selected draft versions atomically');
reset role;
select is((select status from public.rubric_versions where id=(public.get_tryout_setup_configuration('e8000000-0000-4000-8000-000000000001','e8000000-0000-4000-8000-000000000091')#>>'{sessions,0,rubric,versionId}')::uuid),'published','newly published tryout uses a published rubric');

-- A fresh evaluator can only start with the new version, while old categories remain readable.
insert into public.organization_members(organization_id,user_id,role,status) values('e8000000-0000-4000-8000-000000000001','e8999999-9999-4999-8999-999999999999','member','active');
insert into public.tryout_staff_assignments(organization_id,user_id,role,scope_kind,tryout_id,session_id,granted_by_user_id) values('e8000000-0000-4000-8000-000000000001','e8999999-9999-4999-8999-999999999999','evaluator','session','e8666666-6666-4666-8666-666666666661','e8888888-8888-4888-8888-888888888881','e8111111-1111-4111-8111-111111111111');
set local role authenticated;
select set_config('request.jwt.claim.sub','e8333333-3333-4333-8333-333333333333',true);
select is((select name from public.rubric_categories where id='e8000000-0000-4000-8000-000000000023'),'Skating','evaluator can load historical pinned categories through RLS');
select set_config('request.jwt.claim.sub','e8999999-9999-4999-8999-999999999999',true);
select is((select outcome from public.save_evaluation_draft('e8000000-0000-4000-8000-000000000001','e8666666-6666-4666-8666-666666666661','e8777777-7777-4777-8777-777777777771','e8000000-0000-4000-8000-000000000014','e8888888-8888-4888-8888-888888888881',null,'e8000000-0000-4000-8000-000000000022',0,'[]')),'invalid_context','a new evaluator cannot start on an obsolete rubric');
select is((select outcome from public.save_evaluation_draft('e8000000-0000-4000-8000-000000000001','e8666666-6666-4666-8666-666666666661','e8777777-7777-4777-8777-777777777771','e8000000-0000-4000-8000-000000000014','e8888888-8888-4888-8888-888888888881',null,(select rubric_version_id from public.session_rubrics where session_id='e8888888-8888-4888-8888-888888888881'),0,'[]')),'saved','a new evaluator starts on the current selected rubric');
reset role;
select * from finish();
rollback;
