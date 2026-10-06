begin;
set local search_path=extensions,public;
select no_plan();
select function_privs_are('public','public_registration_tryout_v3',array['text'],'service_role',array['EXECUTE'],'service can load the immutable form version');
select function_privs_are('public','submit_public_registration_with_notification_v2',array['text','jsonb','text','text','text','uuid'],'service_role',array['EXECUTE'],'service can submit the bound form version');
select function_privs_are('public','submit_public_registration_with_notification',array['text','jsonb','text','text','text'],'service_role',array[]::text[],'legacy wrapper cannot bypass version binding after promotion');
select ok(not has_function_privilege('anon','public.public_registration_tryout_v3(text)','EXECUTE'),'anonymous direct form RPC denied');
select ok(not has_function_privilege('authenticated','public.public_registration_tryout_v3(text)','EXECUTE'),'member direct form RPC denied');
select ok(not has_function_privilege('anon','public.submit_public_registration_with_notification_v2(text,jsonb,text,text,text,uuid)','EXECUTE'),'anonymous direct submission RPC denied');
select ok(not has_function_privilege('authenticated','public.submit_public_registration_with_notification_v2(text,jsonb,text,text,text,uuid)','EXECUTE'),'member direct submission RPC denied');
insert into auth.users(id) values('f1150000-0000-4000-8000-000000000001'),('f1150000-0000-4000-8000-000000000009');
insert into public.organizations(id,name,slug) values('f1150000-0000-4000-8000-000000000002','Waiver Version Test','waiver-version-test');
insert into public.organization_members(organization_id,user_id,role,status) values
('f1150000-0000-4000-8000-000000000002','f1150000-0000-4000-8000-000000000001','administrator','active'),
('f1150000-0000-4000-8000-000000000002','f1150000-0000-4000-8000-000000000009','owner','active');
insert into public.tryouts(id,organization_id,name,slug,sport,timezone,registration_starts_at,registration_ends_at)
values('f1150000-0000-4000-8000-000000000003','f1150000-0000-4000-8000-000000000002','Waiver Camp','waiver-version-camp','Hockey','America/Edmonton',clock_timestamp()-interval '1 hour',clock_timestamp()+interval '1 day');
insert into public.tryout_divisions(id,organization_id,tryout_id,name,sort_order)
values('f1150000-0000-4000-8000-000000000004','f1150000-0000-4000-8000-000000000002','f1150000-0000-4000-8000-000000000003','U15',0);
insert into public.registration_forms(id,organization_id,tryout_id,name)
values('f1150000-0000-4000-8000-000000000005','f1150000-0000-4000-8000-000000000002','f1150000-0000-4000-8000-000000000003','Public Form');
insert into public.registration_form_versions(id,organization_id,tryout_id,registration_form_id,version_number,schema,status,published_at)
values('f1150000-0000-4000-8000-000000000006','f1150000-0000-4000-8000-000000000002','f1150000-0000-4000-8000-000000000003','f1150000-0000-4000-8000-000000000005',1,'{"fields":[{"key":"consent","label":"I agree","kind":"consent","required":true,"sortOrder":0,"waiverText":"Original participation terms."}]}','published',clock_timestamp());
insert into public.tryout_registration_form_selections(organization_id,tryout_id,registration_form_version_id)
values('f1150000-0000-4000-8000-000000000002','f1150000-0000-4000-8000-000000000003','f1150000-0000-4000-8000-000000000006');
update public.tryouts set status='published',published_at=clock_timestamp() where id='f1150000-0000-4000-8000-000000000003';
insert into private.registration_notification_settings(organization_id,tryout_id,notification_email,updated_by_user_id)
values('f1150000-0000-4000-8000-000000000002','f1150000-0000-4000-8000-000000000003','organizer@example.com','f1150000-0000-4000-8000-000000000001');
create temporary table waiver_payload(payload jsonb);
insert into waiver_payload values('{"givenName":"Ava","familyName":"Smith","birthDate":"2013-05-01","guardianName":"Taylor Smith","guardianEmail":"guardian@example.com","divisionId":"f1150000-0000-4000-8000-000000000004","responses":{"consent":true}}');


-- The database independently rejects invalid metadata, including JSON null.
create function pg_temp.try_waiver_field(p_field jsonb) returns void language plpgsql as $$
begin
 insert into public.registration_form_versions(organization_id,tryout_id,registration_form_id,version_number,schema)
 values('f1150000-0000-4000-8000-000000000002','f1150000-0000-4000-8000-000000000003','f1150000-0000-4000-8000-000000000005',99,jsonb_build_object('fields',jsonb_build_array(p_field)));
 delete from public.registration_form_versions where registration_form_id='f1150000-0000-4000-8000-000000000005' and version_number=99;
end $$;
create temporary table waiver_field as select schema->'fields'->0 as field from public.registration_form_versions where id='f1150000-0000-4000-8000-000000000006';
select lives_ok($$select pg_temp.try_waiver_field((select field-'waiverText' from waiver_field))$$,'legacy consent without waiver text remains valid');
select lives_ok($$select pg_temp.try_waiver_field((select field||jsonb_build_object('waiverText',repeat('x',20000)) from waiver_field))$$,'waiver text accepts its maximum length');
select throws_ok($$select pg_temp.try_waiver_field((select field||'{"waiverText":null}' from waiver_field))$$,'23514',null,'null waiver text is rejected');
select throws_ok($$select pg_temp.try_waiver_field((select field||'{"waiverText":42}' from waiver_field))$$,'23514',null,'nonstring waiver text is rejected');
select throws_ok($$select pg_temp.try_waiver_field((select field||'{"waiverText":""}' from waiver_field))$$,'23514',null,'empty waiver text is rejected');
select throws_ok($$select pg_temp.try_waiver_field((select field||jsonb_build_object('waiverText',E' \t\n ') from waiver_field))$$,'23514',null,'whitespace-only waiver text is rejected');
select throws_ok($$select pg_temp.try_waiver_field((select field||jsonb_build_object('waiverText',repeat('x',20001)) from waiver_field))$$,'23514',null,'overlong waiver text is rejected');
select throws_ok($$select pg_temp.try_waiver_field((select field||'{"kind":"checkbox"}' from waiver_field))$$,'23514',null,'waiver text is restricted to consent fields');
select throws_ok($$update public.registration_form_versions set schema=jsonb_set(schema,'{fields,0,waiverText}','"Changed terms"') where id='f1150000-0000-4000-8000-000000000006'$$,'23514',null,'published waiver terms are immutable');
set local request.jwt.claim.role='authenticated';
select throws_ok($$select * from public.public_registration_tryout_v3('waiver-version-camp')$$,'42501','forbidden','form RPC checks service claims even with database owner execution');
select throws_ok($$select * from public.submit_public_registration_with_notification_v2('waiver-version-camp',(select payload from waiver_payload),'waiver-registration-key-000001',repeat('a',64),'https://tryout.example','f1150000-0000-4000-8000-000000000006')$$,'42501','forbidden','submission RPC checks service claims');
set local request.jwt.claim.role='service_role';
select is((select form_version_id from public.public_registration_tryout_v3('waiver-version-camp')),'f1150000-0000-4000-8000-000000000006'::uuid,'form snapshot exposes the selected immutable version');
select is((select form_schema->'fields'->0->>'waiverText' from public.public_registration_tryout_v3('waiver-version-camp')),'Original participation terms.','public snapshot includes the matching waiver terms');
select throws_ok($$select * from public.submit_public_registration_with_notification_v2('waiver-version-camp',(select jsonb_set(payload,'{responses,consent}','false') from waiver_payload),'waiver-registration-key-000001',repeat('a',64),'https://tryout.example','f1150000-0000-4000-8000-000000000006')$$,'22023',null,'required waiver acceptance must be true');
select throws_ok($$select * from public.submit_public_registration_with_notification_v2('waiver-version-camp',(select jsonb_set(payload,'{responses,consent}','"true"') from waiver_payload),'waiver-registration-key-000001',repeat('a',64),'https://tryout.example','f1150000-0000-4000-8000-000000000006')$$,'22023',null,'waiver acceptance must be a boolean');
create temporary table waiver_first as select * from public.submit_public_registration_with_notification_v2('waiver-version-camp',(select payload from waiver_payload),'waiver-registration-key-000001',repeat('a',64),'https://tryout.example','f1150000-0000-4000-8000-000000000006');
select is((select outcome from waiver_first),'submitted','current waiver version is accepted');
select is((select responses->'consent' from public.tryout_registrations where id=(select registration_id from waiver_first)),'true'::jsonb,'waiver acceptance is stored as a boolean');
-- Publish a new immutable revision while the old form remains open elsewhere.
set local request.jwt.claim.sub='f1150000-0000-4000-8000-000000000001';
select is((select outcome from public.save_tryout_wizard_configuration('f1150000-0000-4000-8000-000000000002','f1150000-0000-4000-8000-000000000003','registration',jsonb_build_object('name','Public Form','schema',jsonb_build_object('fields',jsonb_build_array((select field||'{"waiverText":"Revised participation terms."}' from waiver_field)))))),'saved','editing a live waiver publishes a new version');
create temporary table waiver_current as select * from public.public_registration_tryout_v3('waiver-version-camp');
select isnt((select form_version_id from waiver_current),'f1150000-0000-4000-8000-000000000006'::uuid,'new terms have a new version identity');
select is((select form_schema->'fields'->0->>'waiverText' from waiver_current),'Revised participation terms.','selected version and new text are returned together');
select is((select v.schema->'fields'->0->>'waiverText' from public.tryout_registrations r join public.registration_form_versions v on v.id=r.registration_form_version_id where r.id=(select registration_id from waiver_first)),'Original participation terms.','accepted registration retains the exact original terms');
create temporary table waiver_counts as select
 (select count(*) from public.tryout_registrations) registrations,
 (select count(*) from public.athletes) athletes,
 (select count(*) from public.guardians) guardians,
 (select count(*) from public.registration_confirmation_tokens) tokens,
 (select count(*) from public.outbox_jobs) jobs,
 (select count(*) from public.audit_logs) audits,
 (select coalesce(sum(attempts),0) from public.registration_rate_counters) attempts;
select is((select outcome from public.submit_public_registration_with_notification_v2('waiver-version-camp',(select payload||'{"givenName":"Stale"}' from waiver_payload),'waiver-registration-key-000002',repeat('b',64),'https://tryout.example','f1150000-0000-4000-8000-000000000006')),'form_changed','fresh stale form is rejected before writes');
select is((select outcome from public.submit_public_registration_with_notification_v2('waiver-version-camp',(select payload from waiver_payload),'waiver-registration-key-000003',repeat('c',64),'https://tryout.example',null)),'form_changed','missing version cannot bypass binding');
select ok((select registrations=(select count(*) from public.tryout_registrations) and athletes=(select count(*) from public.athletes) and guardians=(select count(*) from public.guardians) and tokens=(select count(*) from public.registration_confirmation_tokens) and jobs=(select count(*) from public.outbox_jobs) and audits=(select count(*) from public.audit_logs) and attempts=(select coalesce(sum(attempts),0) from public.registration_rate_counters) from waiver_counts),'stale rejection writes no registration, identity, token, outbox, audit or rate state');
create temporary table waiver_replay as select * from public.submit_public_registration_with_notification_v2('waiver-version-camp',(select payload from waiver_payload),'waiver-registration-key-000001',repeat('a',64),'https://tryout.example','f1150000-0000-4000-8000-000000000006');
select is((select outcome from waiver_replay),'replayed','accepted old waiver retry remains safe after terms change');
select is((select registration_id from waiver_replay),(select registration_id from waiver_first),'accepted retry keeps its registration identity');
select is((select count(*) from public.outbox_jobs),(select jobs from waiver_counts),'accepted retry creates no duplicate notification');
select is((select outcome from public.submit_public_registration_with_notification_v2('waiver-version-camp',(select payload||'{"givenName":"Changed"}' from waiver_payload),'waiver-registration-key-000001',repeat('a',64),'https://tryout.example','f1150000-0000-4000-8000-000000000006')),'idempotency_conflict','old waiver retry still verifies the entire submission digest');
select is((select outcome from public.submit_public_registration_with_notification_v2('waiver-version-camp',(select payload from waiver_payload),'waiver-registration-key-000001',repeat('a',64),'https://tryout.example','f1150000-0000-4000-8000-000000000099')),'form_changed','stored key does not permit an unrelated expected version');
select is((select outcome from public.submit_public_registration_with_notification_v2('waiver-version-camp',(select payload||'{"givenName":"Current"}' from waiver_payload),'waiver-registration-key-000004',repeat('d',64),'https://tryout.example',(select form_version_id from waiver_current))),'submitted','fresh submission accepts the current revised terms');
select is((select count(*) from public.tryout_registrations where registration_form_version_id=(select form_version_id from waiver_current)),1::bigint,'new acceptance is bound to the revised version');
-- Staff acceptance uses the exact rendered schema, including mutable drafts.
select function_privs_are('public','create_staff_registration_v2',array['uuid','uuid','uuid','uuid','uuid','text','text','date','jsonb','text','jsonb'],'authenticated',array['EXECUTE'],'staff can execute the schema-bound command');
select function_privs_are('public','create_staff_registration',array['uuid','uuid','uuid','uuid','uuid','text','text','date','jsonb','text'],'authenticated',array[]::text[],'staff cannot bypass schema binding through the old command');
select ok(not has_function_privilege('anon','public.create_staff_registration_v2(uuid,uuid,uuid,uuid,uuid,text,text,date,jsonb,text,jsonb)','EXECUTE'),'anonymous staff command denied');
select ok(not has_function_privilege('service_role','public.create_staff_registration_v2(uuid,uuid,uuid,uuid,uuid,text,text,date,jsonb,text,jsonb)','EXECUTE'),'service role has no staff-command bypass');
set local request.jwt.claim.role='authenticated';
set local request.jwt.claim.sub='f1150000-0000-4000-8000-000000000099';
select throws_ok($$select * from public.create_staff_registration_v2('f1150000-0000-4000-8000-000000000002','f1150000-0000-4000-8000-000000000003',null,'f1150000-0000-4000-8000-000000000004',null,'Staff','Athlete','2013-05-01','{"consent":true}',repeat('e',64),(select form_schema from waiver_current))$$,'42501','forbidden','staff capability is checked before schema access');
set local request.jwt.claim.sub='f1150000-0000-4000-8000-000000000001';
create temporary table waiver_staff_counts as select
 (select count(*) from public.tryout_registrations) registrations,
 (select count(*) from public.athletes) athletes,
 (select count(*) from public.audit_logs) audits;
select is((select outcome from public.create_staff_registration_v2('f1150000-0000-4000-8000-000000000002','f1150000-0000-4000-8000-000000000003',null,'f1150000-0000-4000-8000-000000000004',null,'Staff','Athlete','2013-05-01','{"consent":true}',repeat('e',64),(select schema from public.registration_form_versions where id='f1150000-0000-4000-8000-000000000006'))),'form_changed','staff cannot accept revised terms using an older rendered schema');
select is((select outcome from public.create_staff_registration_v2('f1150000-0000-4000-8000-000000000002','f1150000-0000-4000-8000-000000000003',null,'f1150000-0000-4000-8000-000000000004',null,'Staff','Athlete','2013-05-01','{"consent":true}',repeat('e',64),null)),'form_changed','missing staff schema fails closed');
select ok((select registrations=(select count(*) from public.tryout_registrations) and athletes=(select count(*) from public.athletes) and audits=(select count(*) from public.audit_logs) from waiver_staff_counts),'stale staff acceptance writes no registration, identity or audit');
create temporary table waiver_staff_first as select * from public.create_staff_registration_v2('f1150000-0000-4000-8000-000000000002','f1150000-0000-4000-8000-000000000003',null,'f1150000-0000-4000-8000-000000000004',null,'Staff','Athlete','2013-05-01','{"consent":true}',repeat('e',64),(select form_schema from waiver_current));
select is((select outcome from waiver_staff_first),'created','staff can accept the exact current schema');
select is((select registration_form_version_id from public.tryout_registrations where id=(select registration_id from waiver_staff_first)),(select form_version_id from waiver_current),'staff acceptance retains the matched current version');
select is((select outcome from public.create_staff_registration_v2('f1150000-0000-4000-8000-000000000002','f1150000-0000-4000-8000-000000000003',null,'f1150000-0000-4000-8000-000000000004',null,'Staff','Athlete','2013-05-01','{"consent":true}',repeat('e',64),(select form_schema from waiver_current))),'replayed','bound staff wrapper preserves unchanged request replay');
-- Accepted staff waiver terms are frozen even while the tryout stays draft.
insert into public.tryouts(id,organization_id,name,slug,sport,timezone)
values('f1150000-0000-4000-8000-000000000010','f1150000-0000-4000-8000-000000000002','Draft Waiver Camp','draft-waiver-version-camp','Hockey','America/Edmonton');
insert into public.tryout_divisions(id,organization_id,tryout_id,name,sort_order)
values('f1150000-0000-4000-8000-000000000013','f1150000-0000-4000-8000-000000000002','f1150000-0000-4000-8000-000000000010','U15',0);
insert into public.registration_forms(id,organization_id,tryout_id,name)
values('f1150000-0000-4000-8000-000000000011','f1150000-0000-4000-8000-000000000002','f1150000-0000-4000-8000-000000000010','Draft Form');
insert into public.registration_form_versions(id,organization_id,tryout_id,registration_form_id,version_number,schema)
values('f1150000-0000-4000-8000-000000000012','f1150000-0000-4000-8000-000000000002','f1150000-0000-4000-8000-000000000010','f1150000-0000-4000-8000-000000000011',1,(select form_schema from waiver_current));
insert into public.tryout_registration_form_selections(organization_id,tryout_id,registration_form_version_id)
values('f1150000-0000-4000-8000-000000000002','f1150000-0000-4000-8000-000000000010','f1150000-0000-4000-8000-000000000012');
select is((select outcome from public.create_staff_registration_v2('f1150000-0000-4000-8000-000000000002','f1150000-0000-4000-8000-000000000010',null,'f1150000-0000-4000-8000-000000000013',null,'Draft','Athlete','2013-05-01','{"consent":true}',repeat('f',64),(select form_schema from waiver_current))),'created','staff can accept current waiver terms in a draft tryout');
select ok((select status='published' and published_at is not null from public.registration_form_versions where id='f1150000-0000-4000-8000-000000000012'),'accepted draft waiver version becomes an immutable published snapshot');
select is((select status from public.tryouts where id='f1150000-0000-4000-8000-000000000010'),'draft','freezing waiver terms does not publish the tryout');
select throws_ok($$update public.registration_form_versions set schema=jsonb_set(schema,'{fields,0,waiverText}','"Rewritten accepted terms"') where id='f1150000-0000-4000-8000-000000000012'$$,'23514',null,'accepted draft waiver terms cannot be rewritten');
select is((select outcome from public.save_tryout_wizard_configuration('f1150000-0000-4000-8000-000000000002','f1150000-0000-4000-8000-000000000010','registration',jsonb_build_object('name','Draft Form','schema',jsonb_set((select form_schema from waiver_current),'{fields,0,waiverText}','"Next draft terms"')))),'saved','organizer can continue editing through a new draft version');
select ok((select registration_form_version_id<>'f1150000-0000-4000-8000-000000000012'::uuid from public.tryout_registration_form_selections where tryout_id='f1150000-0000-4000-8000-000000000010'),'editing replaces selection with a new draft version');
select is((select v.schema->'fields'->0->>'waiverText' from public.tryout_registrations r join public.registration_form_versions v on v.id=r.registration_form_version_id where r.tryout_id='f1150000-0000-4000-8000-000000000010'),'Revised participation terms.','staff acceptance retains the exact terms after organizer edits');
select * from finish();
rollback;
