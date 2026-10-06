begin;
set local search_path=extensions,public;
select no_plan();
select has_table('private','registration_notification_settings','destination is stored privately');
select has_function('public','get_registration_form_configuration',array['uuid','uuid'],'selected configuration has scoped read RPC');
select has_function('public','save_registration_form_configuration',array['uuid','uuid','jsonb'],'form and destination save together');
select has_function('public','queue_organizer_registration_notification',array['uuid','text'],'organizer notifications use durable outbox');


select ok(not has_table_privilege('anon','private.registration_notification_settings','select'),'public cannot read destinations');
select ok(not has_table_privilege('authenticated','private.registration_notification_settings','select'),'members must use scoped destination read');
select ok(not has_function_privilege('authenticated','public.queue_organizer_registration_notification(uuid,text)','execute'),'members cannot enqueue arbitrary notifications');
select ok(not has_function_privilege('anon','public.queue_organizer_registration_notification(uuid,text)','execute'),'public cannot enqueue notifications');
select ok(has_function_privilege('service_role','public.queue_organizer_registration_notification(uuid,text)','execute'),'service can enqueue');

insert into auth.users(id) values('f1080000-0000-4000-8000-000000000001'),('f1080000-0000-4000-8000-000000000099'),('f1080000-0000-4000-8000-000000000098');
insert into public.organizations(id,name,slug) values('f1080000-0000-4000-8000-000000000002','Notice Test','notice-test');
insert into public.organization_members(organization_id,user_id,role,status)
values('f1080000-0000-4000-8000-000000000002','f1080000-0000-4000-8000-000000000001','administrator','active'),
('f1080000-0000-4000-8000-000000000002','f1080000-0000-4000-8000-000000000098','owner','active');
insert into public.tryouts(id,organization_id,name,slug,sport,timezone)
values('f1080000-0000-4000-8000-000000000003','f1080000-0000-4000-8000-000000000002','Camp','notice-camp','Hockey','America/Edmonton');
insert into public.tryout_divisions(id,organization_id,tryout_id,name,sort_order)
values('f1080000-0000-4000-8000-000000000004','f1080000-0000-4000-8000-000000000002','f1080000-0000-4000-8000-000000000003','U15',0);

set local role authenticated;
set local request.jwt.claim.sub='f1080000-0000-4000-8000-000000000099';
select throws_ok($$select * from public.get_registration_form_configuration('f1080000-0000-4000-8000-000000000002','f1080000-0000-4000-8000-000000000003')$$,'42501',null,'outsider cannot read selected form');
select throws_ok($$select * from public.get_registration_notification_settings('f1080000-0000-4000-8000-000000000002','f1080000-0000-4000-8000-000000000003')$$,'42501',null,'outsider cannot read destination');
select throws_ok($$select * from public.save_registration_form_configuration('f1080000-0000-4000-8000-000000000002','f1080000-0000-4000-8000-000000000003','{"name":"Form","notificationEmail":"outsider@example.com"}')$$,'42501',null,'outsider cannot configure notification');
set local request.jwt.claim.sub='f1080000-0000-4000-8000-000000000001';
select is((select count(*) from public.get_registration_form_configuration('f1080000-0000-4000-8000-000000000002','f1080000-0000-4000-8000-000000000003')),0::bigint,'no selection returns no form');
select is((select outcome from public.save_registration_form_configuration('f1080000-0000-4000-8000-000000000002','f1080000-0000-4000-8000-000000000003','{"name":"Form","schema":{"fields":[]},"notificationEmail":" Organizer@example.com "}')),'saved','manager saves form and destination');
select is((select form_name from public.get_registration_form_configuration('f1080000-0000-4000-8000-000000000002','f1080000-0000-4000-8000-000000000003')),'Form','administrator can load selected form');
select is((select form_schema from public.get_registration_form_configuration('f1080000-0000-4000-8000-000000000002','f1080000-0000-4000-8000-000000000003')),'{"fields":[]}'::jsonb,'selected schema matches saved schema');
set local request.jwt.claim.sub='f1080000-0000-4000-8000-000000000098';
select is((select form_name from public.get_registration_form_configuration('f1080000-0000-4000-8000-000000000002','f1080000-0000-4000-8000-000000000003')),'Form','owner can load selected form');
set local request.jwt.claim.sub='f1080000-0000-4000-8000-000000000001';
select is((select notification_email from public.get_registration_notification_settings('f1080000-0000-4000-8000-000000000002','f1080000-0000-4000-8000-000000000003')),'organizer@example.com','destination normalizes');
select is((select outcome from public.save_registration_form_configuration('f1080000-0000-4000-8000-000000000002','f1080000-0000-4000-8000-000000000003','{"name":"Bad update","notificationEmail":"bad address"}')),'invalid_input','invalid destination rejects form mutation');
select is((select outcome from public.save_registration_form_configuration('f1080000-0000-4000-8000-000000000002','f1080000-0000-4000-8000-000000000003','{"name":"","notificationEmail":"changed@example.com"}')),'invalid_input','invalid form rejects destination mutation');
select is((select notification_email from public.get_registration_notification_settings('f1080000-0000-4000-8000-000000000002','f1080000-0000-4000-8000-000000000003')),'organizer@example.com','failed writes preserve destination');
select is((select outcome from public.save_registration_form_configuration('f1080000-0000-4000-8000-000000000002','f1080000-0000-4000-8000-000000000003','{"name":"Form","schema":{"fields":[]}}')),'saved','omitted destination preserves existing setting');
select is((select notification_email from public.get_registration_notification_settings('f1080000-0000-4000-8000-000000000002','f1080000-0000-4000-8000-000000000003')),'organizer@example.com','legacy edit does not disable notification');
select is((select outcome from public.save_registration_form_configuration('f1080000-0000-4000-8000-000000000002','f1080000-0000-4000-8000-000000000003',jsonb_build_object('name','Form','notificationEmail',repeat('a',250)||'@b.co'))),'invalid_input','oversized destination is rejected');
select is((select outcome from public.save_registration_form_configuration('f1080000-0000-4000-8000-000000000002','f1080000-0000-4000-8000-000000000003',jsonb_build_object('name','Form','notificationEmail',E'a@example.com\nBcc:bad@example.com'))),'invalid_input','header injection is rejected');
reset role;
select is((select count(*) from public.registration_forms where organization_id='f1080000-0000-4000-8000-000000000002' and name='Bad update'),0::bigint,'invalid email cannot partially create a form');
select ok(not exists(select 1 from public.registration_form_versions where organization_id='f1080000-0000-4000-8000-000000000002' and schema::text like '%organizer@example.com%'),'destination never enters public form schema');
insert into public.registration_forms(id,organization_id,tryout_id,name)
values('f1080000-0000-4000-8000-000000000011','f1080000-0000-4000-8000-000000000002','f1080000-0000-4000-8000-000000000003','Newer unselected form');
insert into public.registration_form_versions(organization_id,tryout_id,registration_form_id,version_number,schema)
values('f1080000-0000-4000-8000-000000000002','f1080000-0000-4000-8000-000000000003','f1080000-0000-4000-8000-000000000011',1,'{"fields":[]}');
select is((select form_name from public.get_registration_form_configuration('f1080000-0000-4000-8000-000000000002','f1080000-0000-4000-8000-000000000003')),'Form','newer unselected form cannot replace selected result');
select is((select registration_form_version_id from public.get_registration_form_configuration('f1080000-0000-4000-8000-000000000002','f1080000-0000-4000-8000-000000000003')),(select registration_form_version_id from public.tryout_registration_form_selections where organization_id='f1080000-0000-4000-8000-000000000002' and tryout_id='f1080000-0000-4000-8000-000000000003'),'result identifies exact selected version');
select ok(not has_function_privilege('anon','public.get_registration_form_configuration(uuid,uuid)','execute'),'anonymous caller cannot read selected configuration');
insert into public.athletes(id,organization_id,given_name,family_name,normalized_given_name,normalized_family_name,birth_date)
values('f1080000-0000-4000-8000-000000000005','f1080000-0000-4000-8000-000000000002','Private','Athlete','private','athlete','2012-01-01');
insert into public.tryout_registrations(id,organization_id,tryout_id,athlete_id,division_id,registration_form_version_id,responses,submission_key_digest)
select 'f1080000-0000-4000-8000-000000000006','f1080000-0000-4000-8000-000000000002','f1080000-0000-4000-8000-000000000003','f1080000-0000-4000-8000-000000000005','f1080000-0000-4000-8000-000000000004',id,'{}',repeat('f',64)
from public.registration_form_versions where organization_id='f1080000-0000-4000-8000-000000000002' limit 1;
set local role service_role;
set local request.jwt.claim.role='service_role';
reset role;
update private.registration_notification_settings set notification_email=null where organization_id='f1080000-0000-4000-8000-000000000002';
set local role service_role;
select is((public.queue_organizer_registration_notification('f1080000-0000-4000-8000-000000000006','https://tryout.example')).outcome,'suppressed','disabled destination creates no delivery');
reset role;
select is((select count(*) from public.outbox_jobs where organization_id='f1080000-0000-4000-8000-000000000002'),0::bigint,'disabled notifications leave no outbox job');
update private.registration_notification_settings set notification_email='organizer@example.com' where organization_id='f1080000-0000-4000-8000-000000000002';
set local role service_role;
select is((public.queue_organizer_registration_notification('f1080000-0000-4000-8000-000000000006','https://tryout.example')).outcome,'queued','submitted registration creates durable notification');
select is((public.queue_organizer_registration_notification('f1080000-0000-4000-8000-000000000006','https://tryout.example')).outcome,'replayed','registration retry is idempotent');
select is((public.queue_organizer_registration_notification('f1080000-0000-4000-8000-000000000006','https://tryout.example/unsafe?token=x')).outcome,'invalid_input','origin cannot smuggle a path or secret');
select is((public.queue_organizer_registration_notification('f1080000-0000-4000-8000-000000000006','http://localhost:3112')).outcome,'replayed','local demo origin can safely replay notification');
select is((public.queue_organizer_registration_notification('f1080000-0000-4000-8000-000000000006','http://untrusted.example:3112')).outcome,'invalid_input','remote plaintext origin is rejected');
reset role;
select is((select count(*) from public.outbox_jobs where organization_id='f1080000-0000-4000-8000-000000000002'),1::bigint,'one notification job per registration');
select is((select recipient_snapshot from public.communication_messages where organization_id='f1080000-0000-4000-8000-000000000002'),'{"email":"organizer@example.com"}'::jsonb,'only configured organizer recipient is snapshotted');
select is((select content_snapshot->>'text' from public.communication_messages where organization_id='f1080000-0000-4000-8000-000000000002'),'A new registration has been submitted. Sign in to TryoutFlow to review it: https://tryout.example/app/notice-test/tryouts/f1080000-0000-4000-8000-000000000003/registration','content contains only a notice and authorized application link');
select is((select private.lock_communication_source_reason(id) from public.communication_messages where organization_id='f1080000-0000-4000-8000-000000000002'),null::text,'eligible organizer source passes worker recheck');
update private.registration_notification_settings set notification_email='changed@example.com' where organization_id='f1080000-0000-4000-8000-000000000002';
select is((select private.lock_communication_source_reason(id) from public.communication_messages where organization_id='f1080000-0000-4000-8000-000000000002'),'recipient_changed','destination changed after queue blocks delivery');
update private.registration_notification_settings set notification_email='organizer@example.com' where organization_id='f1080000-0000-4000-8000-000000000002';
update public.organization_members set status='disabled' where organization_id='f1080000-0000-4000-8000-000000000002' and user_id='f1080000-0000-4000-8000-000000000001';
select is((select private.lock_communication_source_reason(id) from public.communication_messages where organization_id='f1080000-0000-4000-8000-000000000002'),'authorizer_offboarded','offboarded manager cannot authorize notification');
update public.organization_members set status='active' where organization_id='f1080000-0000-4000-8000-000000000002';
update public.tryout_registrations set status='withdrawn' where id='f1080000-0000-4000-8000-000000000006';
select is((select private.lock_communication_source_reason(id) from public.communication_messages where organization_id='f1080000-0000-4000-8000-000000000002'),'registration_ineligible','withdrawn registration cannot send organizer notice');
select is((select count(*) from public.outbox_provider_handoffs where organization_id='f1080000-0000-4000-8000-000000000002'),0::bigint,'test only queues locally and never attempts provider handoff');
select * from finish();
rollback;
