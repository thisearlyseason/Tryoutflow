begin;
set local search_path=extensions,public;
select no_plan();
-- A pre-existing optional flag must never make an enabled waiver optional.
insert into auth.users(id) values('f1180000-0000-4000-8000-000000000001'),('f1180000-0000-4000-8000-000000000009');
insert into public.organizations(id,name,slug) values('f1180000-0000-4000-8000-000000000002','Enabled Waiver Test','enabled-waiver-test');
insert into public.organization_members(organization_id,user_id,role,status) values
('f1180000-0000-4000-8000-000000000002','f1180000-0000-4000-8000-000000000001','administrator','active'),
('f1180000-0000-4000-8000-000000000002','f1180000-0000-4000-8000-000000000009','owner','active');
insert into public.tryouts(id,organization_id,name,slug,sport,timezone,registration_starts_at,registration_ends_at)
values('f1180000-0000-4000-8000-000000000003','f1180000-0000-4000-8000-000000000002','Waiver Camp','enabled-waiver-camp','Hockey','America/Edmonton',clock_timestamp()-interval '1 hour',clock_timestamp()+interval '1 day');
insert into public.tryout_divisions(id,organization_id,tryout_id,name,sort_order)
values('f1180000-0000-4000-8000-000000000004','f1180000-0000-4000-8000-000000000002','f1180000-0000-4000-8000-000000000003','U15',0);
insert into public.registration_forms(id,organization_id,tryout_id,name)
values('f1180000-0000-4000-8000-000000000005','f1180000-0000-4000-8000-000000000002','f1180000-0000-4000-8000-000000000003','Public Form');
insert into public.registration_form_versions(id,organization_id,tryout_id,registration_form_id,version_number,schema,status,published_at)
values('f1180000-0000-4000-8000-000000000006','f1180000-0000-4000-8000-000000000002','f1180000-0000-4000-8000-000000000003','f1180000-0000-4000-8000-000000000005',1,'{"fields":[{"key":"consent","label":"I agree","kind":"consent","required":false,"enabled":true,"sortOrder":0,"waiverText":"Original participation terms."}]}','published',clock_timestamp());
insert into public.tryout_registration_form_selections(organization_id,tryout_id,registration_form_version_id)
values('f1180000-0000-4000-8000-000000000002','f1180000-0000-4000-8000-000000000003','f1180000-0000-4000-8000-000000000006');
update public.tryouts set status='published',published_at=clock_timestamp() where id='f1180000-0000-4000-8000-000000000003';
insert into private.registration_notification_settings(organization_id,tryout_id,notification_email,updated_by_user_id)
values('f1180000-0000-4000-8000-000000000002','f1180000-0000-4000-8000-000000000003','organizer@example.com','f1180000-0000-4000-8000-000000000001');
create temporary table waiver_payload(payload jsonb);
insert into waiver_payload values('{"givenName":"Ava","familyName":"Smith","birthDate":"2013-05-01","guardianName":"Taylor Smith","guardianEmail":"guardian@example.com","divisionId":"f1180000-0000-4000-8000-000000000004","responses":{"consent":true}}');



create temporary table enabled_waiver_schema as
select schema from public.registration_form_versions
where id='f1180000-0000-4000-8000-000000000006';
select throws_ok($$select private.normalize_registration_responses((select schema from enabled_waiver_schema),'{}')$$,'22023',null,'enabled optional-flag waiver rejects missing acceptance');
select throws_ok($$select private.normalize_registration_responses((select schema from enabled_waiver_schema),'{"consent":null}')$$,'22023',null,'enabled optional-flag waiver rejects null acceptance');
select throws_ok($$select private.normalize_registration_responses((select schema from enabled_waiver_schema),'{"consent":false}')$$,'22023',null,'enabled optional-flag waiver rejects false acceptance');
select throws_ok($$select private.normalize_registration_responses((select schema from enabled_waiver_schema),'{"consent":"true"}')$$,'22023',null,'enabled waiver rejects a string acceptance');
select is(private.normalize_registration_responses((select schema from enabled_waiver_schema),'{"consent":true}'),'{"consent":true}'::jsonb,'enabled optional-flag waiver accepts literal true');
select throws_ok($$select private.normalize_registration_responses((select jsonb_set(schema,'{fields,0}',(schema->'fields'->0)-'enabled') from enabled_waiver_schema),'{}')$$,'22023',null,'legacy waiver without enabled flag also requires acceptance');
select is(private.normalize_registration_responses((select jsonb_set(schema,'{fields,0,enabled}','false') from enabled_waiver_schema),'{}'),'{}'::jsonb,'disabled waiver does not require acceptance');
select is(private.normalize_registration_responses((select jsonb_set(schema,'{fields,0,enabled}','false') from enabled_waiver_schema),'{"consent":null}'),'{}'::jsonb,'disabled waiver null answer is removed');
select is(private.normalize_registration_responses('{"fields":[{"key":"updates","kind":"checkbox","required":false}]}','{"updates":false}'),'{"updates":false}'::jsonb,'ordinary optional checkbox may remain false');
select is(private.normalize_registration_responses('{"fields":[{"key":"updates","kind":"checkbox","required":true}]}','{"updates":false}'),'{"updates":false}'::jsonb,'ordinary required checkbox still accepts false as an answer');

-- Verify the externally callable submission boundary rejects before any writes.
set local request.jwt.claim.role='service_role';
create temporary table before_waiver_attempts as select
 (select count(*) from public.tryout_registrations) registrations,
 (select count(*) from public.athletes) athletes,
 (select count(*) from public.guardians) guardians,
 (select count(*) from public.registration_confirmation_tokens) tokens,
 (select count(*) from public.outbox_jobs) jobs,
 (select count(*) from public.audit_logs) audits;
select throws_ok($$select * from public.submit_public_registration_with_notification_v2('enabled-waiver-camp',(select jsonb_set(payload,'{responses}','{}') from waiver_payload),'enabled-waiver-key-000001',repeat('a',64),'https://tryout.example','f1180000-0000-4000-8000-000000000006')$$,'22023',null,'public submission rejects missing optional-flag waiver');
select throws_ok($$select * from public.submit_public_registration_with_notification_v2('enabled-waiver-camp',(select jsonb_set(payload,'{responses,consent}','null') from waiver_payload),'enabled-waiver-key-000001',repeat('a',64),'https://tryout.example','f1180000-0000-4000-8000-000000000006')$$,'22023',null,'public submission rejects null optional-flag waiver');
select throws_ok($$select * from public.submit_public_registration_with_notification_v2('enabled-waiver-camp',(select jsonb_set(payload,'{responses,consent}','false') from waiver_payload),'enabled-waiver-key-000001',repeat('a',64),'https://tryout.example','f1180000-0000-4000-8000-000000000006')$$,'22023',null,'public submission rejects false optional-flag waiver');
select ok((select registrations=(select count(*) from public.tryout_registrations) and athletes=(select count(*) from public.athletes) and guardians=(select count(*) from public.guardians) and tokens=(select count(*) from public.registration_confirmation_tokens) and jobs=(select count(*) from public.outbox_jobs) and audits=(select count(*) from public.audit_logs) from before_waiver_attempts),'waiver rejection creates no registration, identity, token, notification or audit');
create temporary table waiver_accepted as select * from public.submit_public_registration_with_notification_v2('enabled-waiver-camp',(select payload from waiver_payload),'enabled-waiver-key-000001',repeat('a',64),'https://tryout.example','f1180000-0000-4000-8000-000000000006');
select is((select outcome from waiver_accepted),'submitted','public submission accepts checked optional-flag waiver');
select is((select responses from public.tryout_registrations where id=(select registration_id from waiver_accepted)),'{"consent":true}'::jsonb,'registration stores the explicit waiver acceptance');
select is((select schema from public.registration_form_versions where id='f1180000-0000-4000-8000-000000000006'),(select schema from enabled_waiver_schema),'acceptance does not rewrite immutable form schema or required flag');
select throws_ok($$update public.tryout_registrations set responses='{"consent":false}' where id=(select registration_id from waiver_accepted)$$,'22023',null,'table boundary independently rejects false optional-flag waiver');
select is((select outcome from public.submit_public_registration_with_notification_v2('enabled-waiver-camp',(select payload from waiver_payload),'enabled-waiver-key-000001',repeat('a',64),'https://tryout.example','f1180000-0000-4000-8000-000000000006')),'replayed','checked waiver retries preserve accepted registration');

set local request.jwt.claim.sub='f1180000-0000-4000-8000-000000000001';
set local request.jwt.claim.role='authenticated';
select throws_ok($$select * from public.create_staff_registration_v2('f1180000-0000-4000-8000-000000000002','f1180000-0000-4000-8000-000000000003',null,'f1180000-0000-4000-8000-000000000004',null,'Staff','Athlete','2013-05-01','{"consent":false}',repeat('e',64),(select schema from enabled_waiver_schema))$$,'22023',null,'staff submission rejects false optional-flag waiver');
select is((select outcome from public.create_staff_registration_v2('f1180000-0000-4000-8000-000000000002','f1180000-0000-4000-8000-000000000003',null,'f1180000-0000-4000-8000-000000000004',null,'Staff','Athlete','2013-05-01','{"consent":true}',repeat('e',64),(select schema from enabled_waiver_schema))),'created','staff submission accepts checked optional-flag waiver');
-- Hiding a waiver remains an explicit form revision, with no fabricated assent.
select is((select outcome from public.save_tryout_wizard_configuration('f1180000-0000-4000-8000-000000000002','f1180000-0000-4000-8000-000000000003','registration',jsonb_build_object('name','Public Form','schema',jsonb_set((select schema from enabled_waiver_schema),'{fields,0,enabled}','false')))),'saved','organizer can hide a waiver through a new form revision');
set local request.jwt.claim.role='service_role';
select is((select outcome from public.submit_public_registration_with_notification_v2('enabled-waiver-camp',(select jsonb_set(payload||'{"givenName":"Disabled"}','{responses}','{}') from waiver_payload),'disabled-waiver-key-000001',repeat('b',64),'https://tryout.example',(select form_version_id from public.public_registration_tryout_v3('enabled-waiver-camp')))),'submitted','public submission can omit a disabled waiver');
select is((select responses from public.tryout_registrations where id=(select registration_id from waiver_accepted)),'{"consent":true}'::jsonb,'later form revision preserves the original accepted waiver response');
select * from finish();
rollback;
