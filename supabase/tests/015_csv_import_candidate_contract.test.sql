begin;
select plan(19);

select has_function('public','lock_canonical_athlete_identity',array['uuid','text','text','date'],'one canonical athlete identity lock exists');
select ok(not has_function_privilege('anon','public.lock_canonical_athlete_identity(uuid,text,text,date)','execute'),'anonymous users cannot acquire internal identity locks');
select ok(not has_function_privilege('authenticated','public.lock_canonical_athlete_identity(uuid,text,text,date)','execute'),'authenticated users cannot acquire internal identity locks');
select ok(not has_function_privilege('service_role','public.lock_canonical_athlete_identity(uuid,text,text,date)','execute'),'service role cannot acquire internal identity locks');
select trigger_is('public','athletes','lock_athlete_identity_before_insert','public','lock_athlete_identity_before_insert','every athlete insert uses the shared identity lock');

insert into auth.users(id) values ('30303030-3030-4030-8030-303030303030');
insert into public.organizations(id,name,slug,timezone)
values ('a3030303-3030-4030-8030-303030303030','Candidate Contract','candidate-contract','America/Edmonton');
insert into public.organization_members(organization_id,user_id,role,status)
values ('a3030303-3030-4030-8030-303030303030','30303030-3030-4030-8030-303030303030','owner','active');
insert into public.athletes(id,organization_id,given_name,family_name,normalized_given_name,normalized_family_name,birth_date)
values
  ('f3030303-3030-4030-8030-303030303030','a3030303-3030-4030-8030-303030303030','Ava','Smith','ava','smith','2013-05-01'),
  ('13030303-3030-4030-8030-303030303030','a3030303-3030-4030-8030-303030303030','Ava','Smith','ava','smith','2013-05-01');

select is(
  public.current_athlete_import_candidate_ids(
    'a3030303-3030-4030-8030-303030303030',
    '[
      {"row":2,"status":"duplicate_candidate","errors":[],"athlete":{"givenName":"Ava","familyName":"Smith","birthDate":"2013-05-01"},"duplicateCandidateIds":[]},
      {"row":3,"status":"duplicate_candidate","errors":[],"athlete":{"givenName":"Ava","familyName":"Smith","birthDate":"2013-05-01"},"duplicateCandidateIds":[]},
      {"row":4,"status":"duplicate_candidate","errors":[],"athlete":{"givenName":"Ava","familyName":"Smith","birthDate":"2013-05-01"},"duplicateCandidateIds":[]}
    ]',4
  ),
  '["13030303-3030-4030-8030-303030303030","f3030303-3030-4030-8030-303030303030","preview-row:2","preview-row:3"]'::jsonb,
  'multiple existing candidates and every eligible prior duplicate row have one sorted unique representation'
);

select is(
  public.current_athlete_import_candidate_ids(
    'a3030303-3030-4030-8030-303030303030',
    '[
      {"row":2,"status":"invalid","errors":["birth_date_invalid"],"athlete":{"givenName":"Ava","familyName":"Smith","birthDate":"2013-05-01"},"duplicateCandidateIds":[]},
      {"row":3,"status":"valid","errors":[],"athlete":{"givenName":"Ava","familyName":"Smith","birthDate":"2013-05-01"},"duplicateCandidateIds":[]}
    ]',3
  ),
  '["13030303-3030-4030-8030-303030303030","f3030303-3030-4030-8030-303030303030"]'::jsonb,
  'invalid prior rows are not candidates'
);

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','30303030-3030-4030-8030-303030303030',true);

create temporary table malformed_preview as select * from public.create_athlete_import_preview(
  'a3030303-3030-4030-8030-303030303030',repeat('2',64),
  '{"givenName":"First","familyName":"Last","birthDate":"DOB"}',
  '[{"row":2,"status":"duplicate_candidate","errors":[],"athlete":{"givenName":"Bad","familyName":"Date","birthDate":"2023-02-29"},"duplicateCandidateIds":["preview-row:1"]}]'
);
select is(
  (select outcome from public.resolve_athlete_import_duplicate('a3030303-3030-4030-8030-303030303030',(select preview_id from malformed_preview),2,'keep_separate')),
  'invalid_decision','a forged malformed duplicate row is rejected before identity-lock date coercion'
);

create temporary table third_row_preview as select * from public.create_athlete_import_preview(
  'a3030303-3030-4030-8030-303030303030',repeat('3',64),
  '{"givenName":"First","familyName":"Last","birthDate":"DOB"}',
  '[
    {"row":2,"status":"duplicate_candidate","errors":[],"athlete":{"givenName":"Ava","familyName":"Smith","birthDate":"2013-05-01"},"duplicateCandidateIds":["13030303-3030-4030-8030-303030303030","f3030303-3030-4030-8030-303030303030"]},
    {"row":3,"status":"duplicate_candidate","errors":[],"athlete":{"givenName":"Ava","familyName":"Smith","birthDate":"2013-05-01"},"duplicateCandidateIds":["13030303-3030-4030-8030-303030303030","f3030303-3030-4030-8030-303030303030","preview-row:2"]},
    {"row":4,"status":"duplicate_candidate","errors":[],"athlete":{"givenName":"Ava","familyName":"Smith","birthDate":"2013-05-01"},"duplicateCandidateIds":["13030303-3030-4030-8030-303030303030","f3030303-3030-4030-8030-303030303030","preview-row:2","preview-row:3"]}
  ]'
);
select is(
  (select outcome from public.resolve_athlete_import_duplicate('a3030303-3030-4030-8030-303030303030',(select preview_id from third_row_preview),4,'keep_separate')),
  'resolved','the third identical preview row resolves against the exact canonical candidate set'
);
select is(
  (select duplicate_decisions->'4'->'candidateIds' from public.athlete_import_previews where id=(select preview_id from third_row_preview)),
  '["13030303-3030-4030-8030-303030303030","f3030303-3030-4030-8030-303030303030","preview-row:2","preview-row:3"]'::jsonb,
  'the recorded decision stores that exact ordered set'
);

reset role;
insert into public.athletes(id,organization_id,given_name,family_name,normalized_given_name,normalized_family_name,birth_date)
values ('23030303-3030-4030-8030-303030303030','a3030303-3030-4030-8030-303030303030','Bea','Jones','bea','jones','2012-01-01');
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','30303030-3030-4030-8030-303030303030',true);
create temporary table emptying_preview as select * from public.create_athlete_import_preview(
  'a3030303-3030-4030-8030-303030303030',repeat('4',64),
  '{"givenName":"First","familyName":"Last","birthDate":"DOB"}',
  '[{"row":2,"status":"duplicate_candidate","errors":[],"athlete":{"givenName":"Bea","familyName":"Jones","birthDate":"2012-01-01"},"duplicateCandidateIds":["23030303-3030-4030-8030-303030303030"]}]'
);
select is(
  (select outcome from public.resolve_athlete_import_duplicate('a3030303-3030-4030-8030-303030303030',(select preview_id from emptying_preview),2,'keep_separate')),
  'resolved','a non-empty exact set can be reviewed'
);
reset role;
delete from public.athletes where id='23030303-3030-4030-8030-303030303030';
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','30303030-3030-4030-8030-303030303030',true);
select is(
  (select outcome from public.commit_athlete_import('a3030303-3030-4030-8030-303030303030',(select preview_id from emptying_preview),array[2])),
  'invalid_selection','a decision is rejected when its exact candidate set becomes empty'
);
select is(
  (select duplicate_decisions ? '2' from public.athlete_import_previews where id=(select preview_id from emptying_preview)),
  false,'the empty-set transition clears the stale decision'
);
select is(
  (select preview_rows->0->>'status' from public.athlete_import_previews where id=(select preview_id from emptying_preview)),
  'valid','an empty recomputation restores a selectable non-duplicate row'
);
select is(
  (select preview_rows->0->'duplicateCandidateIds' from public.athlete_import_previews where id=(select preview_id from emptying_preview)),
  '[]'::jsonb,'the persisted row stores the exact empty candidate set'
);
select is(
  (select outcome from public.commit_athlete_import('a3030303-3030-4030-8030-303030303030',(select preview_id from emptying_preview),array[2])),
  'committed','a fresh request can commit after the empty-set transition was acknowledged'
);
select is(
  (select count(*) from public.athletes where id='23030303-3030-4030-8030-303030303030'),
  0::bigint,'the deleted stale candidate is not resurrected'
);
select is(
  (select count(*) from public.athletes where organization_id='a3030303-3030-4030-8030-303030303030' and normalized_given_name='bea'),
  1::bigint,'only the newly committed athlete exists after empty-set recovery'
);
select is(
  (select count(*) from public.athlete_import_previews where id=(select preview_id from emptying_preview) and committed_at is null),
  0::bigint,'a committed preview is not actionable'
);

select * from finish();
rollback;
