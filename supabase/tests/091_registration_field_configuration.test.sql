begin;
set local search_path=extensions,public;
select no_plan();
insert into auth.users(id) values('f1170000-0000-4000-8000-000000000001'),('f1170000-0000-4000-8000-000000000009');
insert into public.organizations(id,name,slug) values('f1170000-0000-4000-8000-000000000002','Field Configuration Test','field-config-test');
insert into public.organization_members(organization_id,user_id,role,status) values
('f1170000-0000-4000-8000-000000000002','f1170000-0000-4000-8000-000000000001','administrator','active'),
('f1170000-0000-4000-8000-000000000002','f1170000-0000-4000-8000-000000000009','owner','active');
insert into public.tryouts(id,organization_id,name,slug,sport,timezone,registration_starts_at,registration_ends_at)
values('f1170000-0000-4000-8000-000000000003','f1170000-0000-4000-8000-000000000002','Waiver Camp','field-config-camp','Hockey','America/Edmonton',clock_timestamp()-interval '1 hour',clock_timestamp()+interval '1 day');
insert into public.tryout_divisions(id,organization_id,tryout_id,name,sort_order)
values('f1170000-0000-4000-8000-000000000004','f1170000-0000-4000-8000-000000000002','f1170000-0000-4000-8000-000000000003','U15',0);
insert into public.registration_forms(id,organization_id,tryout_id,name)
values('f1170000-0000-4000-8000-000000000005','f1170000-0000-4000-8000-000000000002','f1170000-0000-4000-8000-000000000003','Public Form');
insert into public.registration_form_versions(id,organization_id,tryout_id,registration_form_id,version_number,schema,status,published_at)
values('f1170000-0000-4000-8000-000000000006','f1170000-0000-4000-8000-000000000002','f1170000-0000-4000-8000-000000000003','f1170000-0000-4000-8000-000000000005',1,'{"fields":[{"key":"consent","label":"I agree","kind":"consent","required":true,"sortOrder":0,"waiverText":"Original terms."}]}','published',clock_timestamp());
insert into public.tryout_registration_form_selections(organization_id,tryout_id,registration_form_version_id)
values('f1170000-0000-4000-8000-000000000002','f1170000-0000-4000-8000-000000000003','f1170000-0000-4000-8000-000000000006');
insert into public.tryout_divisions(id,organization_id,tryout_id,name,sort_order)
values('f1170000-0000-4000-8000-000000000014','f1170000-0000-4000-8000-000000000002','f1170000-0000-4000-8000-000000000003','U18',1);
insert into public.tryout_positions(id,organization_id,tryout_id,name,sort_order)
values('f1170000-0000-4000-8000-000000000015','f1170000-0000-4000-8000-000000000002','f1170000-0000-4000-8000-000000000003','Goalie',0);
update public.tryouts set status='published',published_at=clock_timestamp() where id='f1170000-0000-4000-8000-000000000003';

create temporary table configurable_schema(schema jsonb);
insert into configurable_schema values('{"builtInFields":[{"key":"givenName","label":"First name","enabled":true,"required":true,"sortOrder":0},{"key":"familyName","label":"Last name","enabled":true,"required":true,"sortOrder":1},{"key":"guardianEmail","label":"Contact email","enabled":true,"required":true,"sortOrder":2}],"fields":[{"key":"hidden","label":"Hidden consent","kind":"consent","required":true,"enabled":false,"sortOrder":3}]}');
create function pg_temp.try_schema(p_schema jsonb) returns void language plpgsql as $$ begin
 insert into public.registration_form_versions(organization_id,tryout_id,registration_form_id,version_number,schema)
 values('f1170000-0000-4000-8000-000000000002','f1170000-0000-4000-8000-000000000003','f1170000-0000-4000-8000-000000000005',99,p_schema);
 delete from public.registration_form_versions where registration_form_id='f1170000-0000-4000-8000-000000000005' and version_number=99;
end $$;
select lives_ok($$select pg_temp.try_schema((select schema from configurable_schema))$$,'configured core and disabled required custom question are valid');
select throws_ok($$select pg_temp.try_schema((select jsonb_set(schema,'{builtInFields,0,enabled}','false') from configurable_schema))$$,'23514',null,'core identity cannot be hidden');
select throws_ok($$select pg_temp.try_schema((select schema||'{"builtInFields":null}' from configurable_schema))$$,'23514',null,'null builtins rejected');
select throws_ok($$select pg_temp.try_schema((select jsonb_set(schema,'{fields,0,sortOrder}','0') from configurable_schema))$$,'23514',null,'builtin and custom order cannot collide');
select is(private.normalize_registration_responses((select schema from configurable_schema),'{}'),'{}'::jsonb,'disabled required response is not required');
select is(private.normalize_registration_responses((select schema from configurable_schema),'{"hidden":null}'),'{}'::jsonb,'empty hidden answer removed');
select throws_ok($$select private.normalize_registration_responses((select schema from configurable_schema),'{"hidden":true}')$$,'22023',null,'nonempty hidden answer rejected');
select ok(public.canonical_athlete_identity_lock_key('f1170000-0000-4000-8000-000000000002','Ava','Smith',null) is not null,'missing birth date still has an identity lock');

select throws_ok($$select private.normalize_registration_responses((select schema from configurable_schema),'{"hidden":false}')$$,'22023',null,'false is a meaningful hidden response and rejected');
select throws_ok($$select pg_temp.try_schema((select jsonb_set(schema,'{fields,0,key}','"custom_birth_date"') from configurable_schema))$$,'23514',null,'configured forms reject legacy builtin aliases');
set local request.jwt.claim.sub='f1170000-0000-4000-8000-000000000001';
set local request.jwt.claim.role='service_role';
-- First accept the legacy immutable version, then remove its required question.
create temporary table old_payload as select '{"givenName":"Legacy","familyName":"Athlete","birthDate":"2012-01-01","guardianName":"Guardian","guardianEmail":"legacy@example.com","responses":{"consent":true}}'::jsonb payload;
create temporary table legacy_accepted as select * from public.submit_public_registration_with_notification_v2('field-config-camp',(select payload from old_payload),'legacy-field-config-key-000001',repeat('a',64),'https://tryout.example','f1170000-0000-4000-8000-000000000006');
select is((select outcome from legacy_accepted),'submitted','legacy form retains required builtin behavior');
select is((select outcome from public.save_tryout_wizard_configuration('f1170000-0000-4000-8000-000000000002','f1170000-0000-4000-8000-000000000003','registration',jsonb_build_object('name','Public Form','schema',(select schema from configurable_schema)))),'saved','configured questions create a new published version');
create temporary table configured_version as select * from public.public_registration_tryout_v3('field-config-camp');
select is((select outcome from public.submit_public_registration_with_notification_v2('field-config-camp',(select payload from old_payload),'legacy-field-config-key-000001',repeat('a',64),'https://tryout.example','f1170000-0000-4000-8000-000000000006')),'replayed','accepted legacy retry uses original schema after required question deletion and builtin hiding');
select is((select outcome from public.submit_public_registration_with_notification_v2('field-config-camp',(select payload||'{"givenName":"Changed"}' from old_payload),'legacy-field-config-key-000001',repeat('a',64),'https://tryout.example','f1170000-0000-4000-8000-000000000006')),'idempotency_conflict','accepted retry still checks full payload digest after revision');
create temporary table optional_payload as select '{"givenName":"Optional","familyName":"Athlete","guardianEmail":"optional@example.com","responses":{}}'::jsonb payload;
create temporary table optional_accepted as select * from public.submit_public_registration_with_notification_v2('field-config-camp',(select payload from optional_payload),'optional-field-config-key-0001',repeat('b',64),'https://tryout.example',(select form_version_id from configured_version));
select is((select outcome from optional_accepted),'submitted','hidden birth date, guardian name, division and position are omitted');
select ok((select a.birth_date is null from public.athletes a join public.tryout_registrations r on r.athlete_id=a.id where r.id=(select registration_id from optional_accepted)),'missing birth date stored as SQL null');
select ok((select g.name is null from public.guardians g join public.athlete_guardians ag on ag.guardian_id=g.id join public.tryout_registrations r on r.athlete_id=ag.athlete_id where r.id=(select registration_id from optional_accepted)),'missing guardian name stored as SQL null');
select is((select division_id from public.tryout_registrations where id=(select registration_id from optional_accepted)),'f1170000-0000-4000-8000-000000000004'::uuid,'hidden division selects deterministic first division');
select ok(not public.registration_has_missing_information((select registration_id from optional_accepted)),'disabled required question does not block check-in');
select throws_ok($$update public.tryout_registrations set responses='{"hidden":true}' where id=(select registration_id from optional_accepted)$$,'22023',null,'registration table rejects nonempty hidden response independently');
select throws_ok($$select * from public.submit_public_registration_with_notification_v2('field-config-camp',(select payload||'{"birthDate":"2012-01-01"}' from optional_payload),'optional-field-config-key-0002',repeat('c',64),'https://tryout.example',(select form_version_id from configured_version))$$,'22023',null,'hidden builtin answer rejected by SQL');
select throws_ok($$select * from public.submit_public_registration_with_notification_v2('field-config-camp',(select payload||'{"positionId":"f1170000-0000-4000-8000-000000000044"}' from optional_payload),'optional-field-config-key-0002',repeat('c',64),'https://tryout.example',(select form_version_id from configured_version))$$,'22023',null,'hidden position answer rejected by SQL');
select is((select outcome from public.submit_public_registration_with_notification_v2('field-config-camp',(select payload||'{"birthDate":null,"guardianName":"  "}' from optional_payload),'optional-field-config-key-0001',repeat('b',64),'https://tryout.example',(select form_version_id from configured_version))),'replayed','empty optional builtin representations normalize to the accepted digest');
-- Staff placement remains an explicit operator choice while optional identity applies.
create temporary table optional_staff as select * from public.create_staff_registration_v2('f1170000-0000-4000-8000-000000000002','f1170000-0000-4000-8000-000000000003',null,'f1170000-0000-4000-8000-000000000004',null,'Staff','Optional',null,'{}',repeat('d',64),(select form_schema from configured_version));
select is((select outcome from optional_staff),'created','staff can omit configured optional birth date');
select is((select outcome from public.create_staff_registration_v2('f1170000-0000-4000-8000-000000000002','f1170000-0000-4000-8000-000000000003',null,'f1170000-0000-4000-8000-000000000004',null,'Staff','Optional',null,'{}',repeat('d',64),(select form_schema from configured_version))),'replayed','staff optional identity preserves replay');
-- Publish a new required field and verify accepted configured retries use the old version.
select is((select outcome from public.save_tryout_wizard_configuration('f1170000-0000-4000-8000-000000000002','f1170000-0000-4000-8000-000000000003','registration',jsonb_build_object('name','Public Form','schema',jsonb_set((select schema from configurable_schema),'{fields,0,enabled}','true')))),'saved','new revision enables previously hidden required question');
select is((select outcome from public.submit_public_registration_with_notification_v2('field-config-camp',(select payload from optional_payload),'optional-field-config-key-0001',repeat('b',64),'https://tryout.example',(select form_version_id from configured_version))),'replayed','configured accepted retry succeeds after a formerly hidden question becomes required');
select is((select responses from public.tryout_registrations where id=(select registration_id from legacy_accepted)),'{"consent":true}'::jsonb,'original accepted waiver response remains untouched');
select ok(not has_function_privilege('service_role','private.normalize_public_registration_submission(text,jsonb,jsonb)','EXECUTE'),'schema-binding normalizer has no service bypass');
select ok(not has_function_privilege('authenticated','private.registration_builtin_field(jsonb,text)','EXECUTE'),'builtin helper is private');

create temporary table placement_schema as select jsonb_build_object('builtInFields',(schema->'builtInFields')||'[{"key":"divisionId","label":"Division","enabled":true,"required":true,"sortOrder":3},{"key":"positionId","label":"Position","enabled":true,"required":true,"sortOrder":4},{"key":"birthDate","label":"Birth date","enabled":true,"required":false,"sortOrder":5},{"key":"guardianName","label":"Guardian name","enabled":true,"required":false,"sortOrder":6},{"key":"guardianPhone","label":"Phone","enabled":true,"required":true,"sortOrder":7}]'::jsonb,'fields','[]'::jsonb) schema from configurable_schema;
select is((select outcome from public.save_tryout_wizard_configuration('f1170000-0000-4000-8000-000000000002','f1170000-0000-4000-8000-000000000003','registration',jsonb_build_object('name','Public Form','schema',(select schema from placement_schema)))),'saved','placement and contact requirements can be configured');
create temporary table placement_version as select * from public.public_registration_tryout_v3('field-config-camp');
create temporary table placement_payload as select payload||'{"guardianPhone":"403-555-1234","divisionId":"f1170000-0000-4000-8000-000000000014","positionId":"f1170000-0000-4000-8000-000000000015"}'::jsonb payload from optional_payload;
select throws_ok($$select private.normalize_public_registration_submission('field-config-camp',(select payload-'divisionId' from placement_payload))$$,'22023',null,'enabled required division demands a choice with multiple divisions');
select throws_ok($$select private.normalize_public_registration_submission('field-config-camp',(select payload-'positionId' from placement_payload))$$,'22023',null,'enabled required position demands a choice');
select throws_ok($$select private.normalize_public_registration_submission('field-config-camp',(select payload-'guardianPhone' from placement_payload))$$,'22023',null,'enabled required phone demands a value');
select throws_ok($$select private.normalize_public_registration_submission('field-config-camp',(select payload||'{"birthDate":"9999-12-31"}' from placement_payload))$$,'22023',null,'optional birth date still rejects future values');
create temporary table placed_registration as select * from public.submit_public_registration_with_notification_v2('field-config-camp',(select payload from placement_payload),'placement-field-config-key-001',repeat('f',64),'https://tryout.example',(select form_version_id from placement_version));
select is((select outcome from placed_registration),'submitted','required placement and phone accept valid values while optional visible date and name may be omitted');
select is((select position_id from public.tryout_registrations where id=(select registration_id from placed_registration)),'f1170000-0000-4000-8000-000000000015'::uuid,'required position persists through the base transaction');
select is((select division_id from public.tryout_registrations where id=(select registration_id from placed_registration)),'f1170000-0000-4000-8000-000000000014'::uuid,'explicit required division persists');
select is((select g.phone from public.guardians g join public.athlete_guardians ag on ag.guardian_id=g.id join public.tryout_registrations r on r.athlete_id=ag.athlete_id where r.id=(select registration_id from placed_registration)),'403-555-1234','required phone persists through the phone wrapper');
select * from finish();
rollback;
