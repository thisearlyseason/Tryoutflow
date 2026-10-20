begin;
select plan(22);

select has_table('public', 'athlete_import_previews', 'hashed expiring import previews are persisted');
select has_function('public', 'create_athlete_import_preview', array['uuid','text','jsonb','jsonb'], 'preview persistence has a controlled boundary');
select has_function('public', 'commit_athlete_import', array['uuid','uuid','integer[]'], 'commit has a controlled transaction boundary');
select ok(not has_table_privilege('anon', 'public.athlete_import_previews', 'select,insert,update,delete'), 'anonymous users have no preview access');
select ok(not has_function_privilege('anon', 'public.commit_athlete_import(uuid,uuid,integer[])', 'execute'), 'anonymous users cannot commit imports');
select ok(not has_function_privilege('service_role', 'public.commit_athlete_import(uuid,uuid,integer[])', 'execute'), 'service role does not bypass the actor-bound import boundary');

insert into auth.users(id) values
  ('12121212-1212-4212-8212-121212121212'),
  ('13131313-1313-4313-8313-131313131313'),
  ('14141414-1414-4414-8414-141414141414'),
  ('15151515-1515-4515-8515-151515151515');
insert into public.organizations(id,name,slug,timezone) values
  ('a1212121-1212-4212-8212-121212121212','Import One','import-one','America/Edmonton'),
  ('a1313131-1313-4313-8313-131313131313','Import Two','import-two','America/Edmonton');
insert into public.organization_members(organization_id,user_id,role,status) values
  ('a1212121-1212-4212-8212-121212121212','12121212-1212-4212-8212-121212121212','administrator','active'),
  ('a1212121-1212-4212-8212-121212121212','15151515-1515-4515-8515-151515151515','administrator','active'),
  ('a1212121-1212-4212-8212-121212121212','14141414-1414-4414-8414-141414141414','member','active'),
  ('a1313131-1313-4313-8313-131313131313','13131313-1313-4313-8313-131313131313','owner','active');

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','12121212-1212-4212-8212-121212121212',true);

create temporary table preview_result as select * from public.create_athlete_import_preview(
  'a1212121-1212-4212-8212-121212121212', repeat('a',64),
  '{"givenName":"First","familyName":"Last","birthDate":"DOB","guardianName":"Guardian","guardianEmail":"Email"}',
  '[{"row":2,"status":"valid","errors":[],"athlete":{"givenName":" Ava ","familyName":" Smith ","birthDate":"2013-05-01","guardianName":"Taylor Smith","guardianEmail":"guardian@example.com"},"duplicateCandidateIds":[]}]'
);
select ok((select preview_id is not null from preview_result), 'authorized administrator persists a preview');
select ok((select expires_at > now() from preview_result), 'preview receives a short expiry');

create temporary table commit_result as select * from public.commit_athlete_import(
  'a1212121-1212-4212-8212-121212121212',(select preview_id from preview_result),array[2]
);
select is((select outcome from commit_result),'committed','selected valid row commits');
select is((select count(*) from public.athletes where organization_id='a1212121-1212-4212-8212-121212121212'),1::bigint,'commit creates one tenant athlete');
select is((select given_name from public.athletes where organization_id='a1212121-1212-4212-8212-121212121212'),'Ava','commit uses canonical identity normalization');
select is((select count(*) from public.guardians where organization_id='a1212121-1212-4212-8212-121212121212'),1::bigint,'commit creates mapped guardian contact');
select is((select outcome from public.commit_athlete_import('a1212121-1212-4212-8212-121212121212',(select preview_id from preview_result),array[2])),'replayed','repeated identical commit is idempotent');
select is((select count(*) from public.athletes where organization_id='a1212121-1212-4212-8212-121212121212'),1::bigint,'replay creates no duplicate athlete');
select is((select outcome from public.commit_athlete_import('a1212121-1212-4212-8212-121212121212',(select preview_id from preview_result),array[3])),'conflict','different repeat selection conflicts');

select throws_ok(
  $$select * from public.create_athlete_import_preview('a1212121-1212-4212-8212-121212121212',repeat('c',64),'{"givenName":"First","familyName":"Last","birthDate":"DOB"}','[{"row":2,"status":"valid","errors":[],"athlete":{"givenName":"Ava","familyName":"Smith","birthDate":"2013-05-01","privateNotes":"must not persist"},"duplicateCandidateIds":[]}]')$$,
  '22023',null,'preview rejects unknown fields that could smuggle extra PII');
create temporary table invalid_preview as select * from public.create_athlete_import_preview(
  'a1212121-1212-4212-8212-121212121212',repeat('d',64),
  '{"givenName":"First","familyName":"Last","birthDate":"DOB"}',
  '[{"row":2,"status":"valid","errors":[],"athlete":{"givenName":"Bea","familyName":"Jones","birthDate":"2012-01-01"},"duplicateCandidateIds":[]},{"row":3,"status":"valid","errors":[],"athlete":{"givenName":"Cara","familyName":"Jones","birthDate":"2023-02-29"},"duplicateCandidateIds":[]}]'
);
select is((select outcome from public.commit_athlete_import('a1212121-1212-4212-8212-121212121212',(select preview_id from invalid_preview),array[2,3])),'invalid_selection','one malformed selected row rejects the whole transaction');
select is((select count(*) from public.athletes where organization_id='a1212121-1212-4212-8212-121212121212'),1::bigint,'malformed batch rolls back every selected row');

select set_config('request.jwt.claim.sub','15151515-1515-4515-8515-151515151515',true);
select throws_ok(
  format('select * from public.commit_athlete_import(%L,%L,array[2])','a1212121-1212-4212-8212-121212121212',(select preview_id from invalid_preview)),
  '42501',null,'another administrator cannot hijack the creating actor preview');

select set_config('request.jwt.claim.sub','13131313-1313-4313-8313-131313131313',true);
select throws_ok(
  format('select * from public.commit_athlete_import(%L,%L,array[2])','a1212121-1212-4212-8212-121212121212',(select preview_id from preview_result)),
  '42501',null,'cross-tenant owner cannot commit another tenant preview');
select set_config('request.jwt.claim.sub','14141414-1414-4414-8414-141414141414',true);
select throws_ok(
  $$select * from public.create_athlete_import_preview('a1212121-1212-4212-8212-121212121212',repeat('b',64),'{}','[]')$$,
  '42501',null,'regular member cannot persist an import preview');

reset role;
update public.athlete_import_previews set created_at=clock_timestamp()-interval '1 hour',expires_at=clock_timestamp()-interval '30 minutes' where id=(select preview_id from preview_result);
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','12121212-1212-4212-8212-121212121212',true);
create temporary table cleanup_preview as select * from public.create_athlete_import_preview(
  'a1212121-1212-4212-8212-121212121212',repeat('9',64),
  '{"givenName":"First","familyName":"Last","birthDate":"DOB"}',
  '[{"row":2,"status":"invalid","errors":["birth_date_invalid"],"athlete":{"givenName":"Later","familyName":"Preview","birthDate":"bad"},"duplicateCandidateIds":[]}]'
);
select is((select count(*) from public.athlete_import_previews where id=(select preview_id from preview_result)),0::bigint,'expired committed previews are cleaned up instead of retaining PII indefinitely');

select * from finish();
rollback;
