begin;
select plan(14);

select ok(not has_function_privilege('anon','public.current_athlete_import_candidate_ids(uuid,jsonb,integer)','execute'),'anonymous users cannot invoke the internal candidate-set helper');
select ok(not has_function_privilege('authenticated','public.current_athlete_import_candidate_ids(uuid,jsonb,integer)','execute'),'authenticated users cannot invoke the internal candidate-set helper');
select ok(not has_function_privilege('service_role','public.current_athlete_import_candidate_ids(uuid,jsonb,integer)','execute'),'service role cannot invoke the internal candidate-set helper');

insert into auth.users(id) values ('29292929-2929-4929-8929-292929292929');
insert into public.organizations(id,name,slug,timezone)
values ('a2929292-2929-4929-8929-292929292929','Bound Import','bound-import','America/Edmonton');
insert into public.organization_members(organization_id,user_id,role,status)
values ('a2929292-2929-4929-8929-292929292929','29292929-2929-4929-8929-292929292929','owner','active');
insert into public.athletes(id,organization_id,given_name,family_name,normalized_given_name,normalized_family_name,birth_date)
values ('b2929292-2929-4929-8929-292929292929','a2929292-2929-4929-8929-292929292929','Ava','Smith','ava','smith','2013-05-01');

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','29292929-2929-4929-8929-292929292929',true);

create temporary table forged as select * from public.create_athlete_import_preview(
  'a2929292-2929-4929-8929-292929292929',repeat('a',64),
  '{"givenName":"First","familyName":"Last","birthDate":"DOB"}',
  '[{"row":2,"status":"valid","errors":[],"athlete":{"givenName":"Ava","familyName":"Smith","birthDate":"2013-05-01"},"duplicateCandidateIds":[]}]'
);
select is(
  (select outcome from public.resolve_athlete_import_duplicate('a2929292-2929-4929-8929-292929292929',(select preview_id from forged),2,'keep_separate')),
  'invalid_decision','a forged valid preview row cannot manufacture a keep-separate decision'
);
select is((select duplicate_decisions from public.athlete_import_previews where id=(select preview_id from forged)),'{}'::jsonb,'forged resolution writes no decision');

create temporary table genuine as select * from public.create_athlete_import_preview(
  'a2929292-2929-4929-8929-292929292929',repeat('b',64),
  '{"givenName":"First","familyName":"Last","birthDate":"DOB"}',
  '[{"row":2,"status":"duplicate_candidate","errors":[],"athlete":{"givenName":"Ava","familyName":"Smith","birthDate":"2013-05-01"},"duplicateCandidateIds":["b2929292-2929-4929-8929-292929292929"]}]'
);
select is(
  (select outcome from public.resolve_athlete_import_duplicate('a2929292-2929-4929-8929-292929292929',(select preview_id from genuine),2,'keep_separate')),
  'resolved','an exact current candidate set can be explicitly resolved'
);
select is((select duplicate_decisions->'2'->>'decision' from public.athlete_import_previews where id=(select preview_id from genuine)),'keep_separate','decision stores a bound record instead of a bare flag');

reset role;
delete from public.athletes where id='b2929292-2929-4929-8929-292929292929';
insert into public.athletes(id,organization_id,given_name,family_name,normalized_given_name,normalized_family_name,birth_date)
values ('c2929292-2929-4929-8929-292929292929','a2929292-2929-4929-8929-292929292929','Ava','Smith','ava','smith','2013-05-01');
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','29292929-2929-4929-8929-292929292929',true);
select is((select outcome from public.commit_athlete_import('a2929292-2929-4929-8929-292929292929',(select preview_id from genuine),array[2])),'invalid_selection','a stale candidate-set decision cannot commit');
select is((select preview_rows->0->'duplicateCandidateIds' from public.athlete_import_previews where id=(select preview_id from genuine)),'["c2929292-2929-4929-8929-292929292929"]'::jsonb,'stale conflict refreshes the exact current candidates');
select is((select duplicate_decisions ? '2' from public.athlete_import_previews where id=(select preview_id from genuine)),false,'stale conflict removes the old authorization');
select is((select count(*) from public.athletes where organization_id='a2929292-2929-4929-8929-292929292929'),1::bigint,'stale decision rejection inserts no athlete');

reset role;
insert into auth.users(id) values ('39393939-3939-4939-8939-393939393939');
insert into public.organization_members(organization_id,user_id,role,status)
values ('a2929292-2929-4929-8929-292929292929','39393939-3939-4939-8939-393939393939','administrator','active');
insert into public.organizations(id,name,slug,timezone)
values ('a3939393-3939-4939-8939-393939393939','Other Bound Import','other-bound-import','America/Edmonton');
insert into public.organization_members(organization_id,user_id,role,status)
values ('a3939393-3939-4939-8939-393939393939','39393939-3939-4939-8939-393939393939','owner','active');
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','39393939-3939-4939-8939-393939393939',true);
select throws_ok(
  $$select * from public.resolve_athlete_import_duplicate('a2929292-2929-4929-8929-292929292929',(select preview_id from genuine),2,'keep_separate')$$,
  '42501','athlete import forbidden','another same-tenant administrator cannot resolve the creator-bound preview'
);
select throws_ok(
  $$select * from public.resolve_athlete_import_duplicate('a3939393-3939-4939-8939-393939393939',(select preview_id from genuine),2,'keep_separate')$$,
  '42501','athlete import forbidden','a cross-tenant identifier cannot resolve the preview'
);
reset role;
update public.athlete_import_previews set created_at=clock_timestamp()-interval '10 minutes',expires_at=clock_timestamp()-interval '1 minute'
where id=(select preview_id from genuine);
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','29292929-2929-4929-8929-292929292929',true);
select is(
  (select outcome from public.resolve_athlete_import_duplicate('a2929292-2929-4929-8929-292929292929',(select preview_id from genuine),2,'keep_separate')),
  'expired','the creator cannot resolve an expired preview'
);

select * from finish();
rollback;
