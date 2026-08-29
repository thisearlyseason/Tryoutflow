begin;
select no_plan();

select is(
  (select proconfig from pg_proc where oid='public.submit_public_registration(text,jsonb,text,text)'::regprocedure),
  array['search_path=""']::text[],
  'the internal public-registration transaction keeps an empty search path'
);
select is(
  (select proconfig from pg_proc where oid='public.canonical_import_text(text)'::regprocedure),
  array['search_path=""']::text[],
  'the shared NFC identity helper keeps an empty search path'
);
select function_privs_are(
  'public','canonical_import_text',array['text'],'anon',array[]::text[],
  'anonymous clients cannot execute the shared NFC identity helper'
);
select function_privs_are(
  'public','canonical_import_text',array['text'],'authenticated',array[]::text[],
  'authenticated clients cannot execute the shared NFC identity helper'
);
select function_privs_are(
  'public','canonical_import_text',array['text'],'service_role',array[]::text[],
  'service role reaches NFC identity normalization only through controlled functions'
);
select function_privs_are(
  'public','canonical_import_text',array['text'],'postgres',array['EXECUTE'],
  'the owner can execute the shared NFC identity helper'
);
select function_privs_are(
  'public','submit_public_registration',array['text','jsonb','text','text'],
  'service_role',array[]::text[],
  'the base public-registration transaction remains internal after replacement'
);
select function_privs_are(
  'public','submit_public_registration_with_phone',array['text','jsonb','text','text'],
  'service_role',array['EXECUTE'],
  'the strict public-registration wrapper remains the service-only entry point'
);

insert into public.organizations(id,name,slug,timezone)
values('a3232323-3232-4232-8232-323232323232','NFC Registration','nfc-registration','America/Edmonton');
insert into public.tryouts(
  id,organization_id,name,slug,sport,timezone,registration_starts_at,registration_ends_at
) values(
  'b3232323-3232-4232-8232-323232323232','a3232323-3232-4232-8232-323232323232',
  'NFC Camp','nfc-registration-camp','Hockey','America/Edmonton',
  clock_timestamp()-interval '1 hour',clock_timestamp()+interval '1 day'
);
insert into public.tryout_divisions(id,organization_id,tryout_id,name,sort_order)
values(
  'c3232323-3232-4232-8232-323232323232','a3232323-3232-4232-8232-323232323232',
  'b3232323-3232-4232-8232-323232323232','U13',0
);
insert into public.registration_forms(id,organization_id,tryout_id,name)
values(
  'd3232323-3232-4232-8232-323232323232','a3232323-3232-4232-8232-323232323232',
  'b3232323-3232-4232-8232-323232323232','Public'
);
insert into public.registration_form_versions(
  id,organization_id,tryout_id,registration_form_id,version_number,schema,status,published_at
) values(
  'e3232323-3232-4232-8232-323232323232','a3232323-3232-4232-8232-323232323232',
  'b3232323-3232-4232-8232-323232323232','d3232323-3232-4232-8232-323232323232',
  1,'{"fields":[{"key":"consent","label":"Consent","kind":"consent","required":true,"sortOrder":0}]}',
  'published',clock_timestamp()
);
insert into public.tryout_registration_form_selections(
  organization_id,tryout_id,registration_form_version_id
) values(
  'a3232323-3232-4232-8232-323232323232','b3232323-3232-4232-8232-323232323232',
  'e3232323-3232-4232-8232-323232323232'
);
update public.tryouts set status='published',published_at=clock_timestamp()
where id='b3232323-3232-4232-8232-323232323232';

insert into public.athletes(
  id,organization_id,given_name,family_name,normalized_given_name,normalized_family_name,birth_date
) values
  (
    '13232323-3232-4232-8232-323232323232','a3232323-3232-4232-8232-323232323232',
    U&'Jos\00e9','Composed','ignored','ignored','2013-05-01'
  ),
  (
    '23232323-3232-4232-8232-323232323232','a3232323-3232-4232-8232-323232323232',
    U&'Jose\0301','Decomposed','ignored','ignored','2013-06-01'
  );
insert into public.guardians(id,organization_id,name,email,normalized_email)
values
  (
    '33232323-3232-4232-8232-323232323232','a3232323-3232-4232-8232-323232323232',
    'Composed Guardian','composed@example.com','composed@example.com'
  ),
  (
    '43232323-3232-4232-8232-323232323232','a3232323-3232-4232-8232-323232323232',
    'Decomposed Guardian','decomposed@example.com','decomposed@example.com'
  );
insert into public.athlete_guardians(organization_id,athlete_id,guardian_id)
values
  (
    'a3232323-3232-4232-8232-323232323232','13232323-3232-4232-8232-323232323232',
    '33232323-3232-4232-8232-323232323232'
  ),
  (
    'a3232323-3232-4232-8232-323232323232','23232323-3232-4232-8232-323232323232',
    '43232323-3232-4232-8232-323232323232'
  );

create temporary table decomposed_submission as
select * from public.submit_public_registration_with_phone(
  'nfc-registration-camp',
  jsonb_build_object(
    'givenName',U&'Jose\0301','familyName','Composed','birthDate','2013-05-01',
    'guardianName','Composed Guardian','guardianEmail','composed@example.com',
    'divisionId','c3232323-3232-4232-8232-323232323232',
    'responses',jsonb_build_object('consent',true)
  ),
  'nfc-decomposed-registration-key-001',repeat('1',64)
);
create temporary table composed_submission as
select * from public.submit_public_registration_with_phone(
  'nfc-registration-camp',
  jsonb_build_object(
    'givenName',U&'Jos\00e9','familyName','Decomposed','birthDate','2013-06-01',
    'guardianName','Decomposed Guardian','guardianEmail','decomposed@example.com',
    'divisionId','c3232323-3232-4232-8232-323232323232',
    'responses',jsonb_build_object('consent',true)
  ),
  'nfc-composed-registration-key-0001',repeat('2',64)
);

select is((select outcome from decomposed_submission),'submitted','decomposed input is accepted through the strict wrapper');
select is((select outcome from composed_submission),'submitted','composed input is accepted through the strict wrapper');
select is(
  (
    select jsonb_agg(to_jsonb(candidate_athlete_id::text) order by candidate_athlete_id)
    from public.registration_duplicate_candidates
    where registration_id=(select registration_id from decomposed_submission)
  ),
  '["13232323-3232-4232-8232-323232323232"]'::jsonb,
  'composed stored identity is emitted for decomposed public input'
);
select is(
  (
    select jsonb_agg(to_jsonb(candidate_athlete_id::text) order by candidate_athlete_id)
    from public.registration_duplicate_candidates
    where registration_id=(select registration_id from composed_submission)
  ),
  '["23232323-3232-4232-8232-323232323232"]'::jsonb,
  'decomposed stored identity is emitted for composed public input'
);
select is(
  (
    select count(distinct athlete_id)
    from public.tryout_registrations
    where id in(
      (select registration_id from decomposed_submission),
      (select registration_id from composed_submission)
    )
  ),
  2::bigint,
  'each NFC-equivalent registration remains a separate athlete pending review'
);
select is(
  (
    select count(*)
    from public.athletes
    where organization_id='a3232323-3232-4232-8232-323232323232'
  ),
  4::bigint,
  'duplicate detection never auto-merges either NFC direction'
);

select * from finish();
rollback;
