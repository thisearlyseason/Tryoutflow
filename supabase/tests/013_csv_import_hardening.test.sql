begin;
select plan(18);

select has_function('public','resolve_athlete_import_duplicate',array['uuid','uuid','integer','text'],'duplicate review has an authorized decision boundary');
select ok(not has_function_privilege('anon','public.resolve_athlete_import_duplicate(uuid,uuid,integer,text)','execute'),'anonymous users cannot resolve import duplicates');
select ok(not has_function_privilege('service_role','public.resolve_athlete_import_duplicate(uuid,uuid,integer,text)','execute'),'service role cannot bypass duplicate decisions');
select ok(not has_function_privilege('anon','public.purge_expired_athlete_import_previews(integer)','execute'),'anonymous users cannot invoke preview purge');
select ok(not has_function_privilege('authenticated','public.canonical_import_text(text)','execute'),'authenticated users cannot call the internal import normalizer');
select ok(not has_function_privilege('service_role','public.canonical_import_text(text)','execute'),'service role cannot call the internal import normalizer');
select has_function('public','resolve_registration_duplicate',array['uuid','uuid','text'],'registration duplicate review has a controlled decision boundary');
select ok(not has_function_privilege('anon','public.resolve_registration_duplicate(uuid,uuid,text)','execute'),'anonymous users cannot resolve registration duplicates');
select ok(not has_function_privilege('service_role','public.resolve_registration_duplicate(uuid,uuid,text)','execute'),'service role cannot bypass registration duplicate decisions');

insert into auth.users(id) values ('18181818-1818-4818-8818-181818181818');
insert into public.organizations(id,name,slug,timezone) values ('a1818181-1818-4818-8818-181818181818','Hardened Import','hardened-import','America/Edmonton');
insert into public.organization_members(organization_id,user_id,role,status) values ('a1818181-1818-4818-8818-181818181818','18181818-1818-4818-8818-181818181818','owner','active');

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','18181818-1818-4818-8818-181818181818',true);

create temporary table duplicate_preview as select * from public.create_athlete_import_preview(
  'a1818181-1818-4818-8818-181818181818',repeat('8',64),
  '{"givenName":"First","familyName":"Last","birthDate":"DOB"}',
  '[{"row":2,"status":"valid","errors":[],"athlete":{"givenName":"Jose\u0301","familyName":"Smith","birthDate":"2013-05-01"},"duplicateCandidateIds":[]},{"row":3,"status":"valid","errors":[],"athlete":{"givenName":"Jos\u00e9","familyName":"Smith","birthDate":"2013-05-01"},"duplicateCandidateIds":[]}]'
);
select is((select outcome from public.commit_athlete_import('a1818181-1818-4818-8818-181818181818',(select preview_id from duplicate_preview),array[2,3])),'invalid_selection','one preview cannot commit canonically identical athlete rows');
select is((select count(*) from public.athletes where organization_id='a1818181-1818-4818-8818-181818181818'),0::bigint,'duplicate-row rejection is atomic');
select is((select preview_rows->1->>'status' from public.athlete_import_previews where id=(select preview_id from duplicate_preview)),'duplicate_candidate','commit-time duplicate conflicts are surfaced for review');

select is((select outcome from public.resolve_athlete_import_duplicate('a1818181-1818-4818-8818-181818181818',(select preview_id from duplicate_preview),3,'keep_separate')),'resolved','administrator can explicitly keep a reviewed candidate separate');
select is((select outcome from public.commit_athlete_import('a1818181-1818-4818-8818-181818181818',(select preview_id from duplicate_preview),array[2,3])),'committed','explicit keep-separate decision permits both records');
select is((select count(*) from public.athletes where organization_id='a1818181-1818-4818-8818-181818181818'),2::bigint,'reviewed separate candidates remain separate records');

create temporary table expired_preview as select * from public.create_athlete_import_preview(
  'a1818181-1818-4818-8818-181818181818',repeat('7',64),
  '{"givenName":"First","familyName":"Last","birthDate":"DOB"}',
  '[{"row":2,"status":"invalid","errors":["birth_date_invalid"],"athlete":{"givenName":"Private","familyName":"Expired","birthDate":"bad"},"duplicateCandidateIds":[]}]'
);
reset role;
update public.athlete_import_previews set created_at=clock_timestamp()-interval '10 minutes',expires_at=clock_timestamp()-interval '1 minute' where id=(select preview_id from expired_preview);
insert into auth.users(id) values ('20202020-2020-4020-8020-202020202020');
insert into public.organizations(id,name,slug,timezone) values ('a2020202-2020-4020-8020-202020202020','Other Import','other-import','America/Edmonton');
insert into public.organization_members(organization_id,user_id,role,status) values ('a2020202-2020-4020-8020-202020202020','20202020-2020-4020-8020-202020202020','owner','active');
insert into public.athlete_import_previews(organization_id,actor_user_id,source_digest,column_mapping,preview_rows,created_at,expires_at)
values('a2020202-2020-4020-8020-202020202020','20202020-2020-4020-8020-202020202020',repeat('6',64),'{"givenName":"First","familyName":"Last","birthDate":"DOB"}','[{"row":2,"status":"invalid","errors":["birth_date_invalid"],"athlete":{"givenName":"Other","familyName":"Private","birthDate":"bad"},"duplicateCandidateIds":[]}]',clock_timestamp()-interval '10 minutes',clock_timestamp()-interval '1 minute');
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','18181818-1818-4818-8818-181818181818',true);
select is((select count(*) from public.athlete_import_previews where id=(select preview_id from expired_preview)),0::bigint,'expired preview PII is hidden by RLS');
select is((select public.purge_expired_athlete_import_previews(100)),1,'bounded purge removes expired preview PII');
reset role;
select is((select count(*) from public.athlete_import_previews where organization_id='a2020202-2020-4020-8020-202020202020'),1::bigint,'tenant purge cannot mutate another organization preview');

select * from finish();
rollback;
