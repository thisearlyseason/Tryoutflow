begin;
select no_plan();

select has_table('public','tryout_teams','tryout teams exist');
select has_table('public','roster_versions','versioned roster snapshots exist');
select has_table('public','roster_assignments','roster placements exist');
select has_table('public','roster_decisions','roster decisions exist');
select has_table('public','decision_history','decision history exists');

insert into auth.users(id) values
  ('b0000000-0000-4000-8000-000000000001'),
  ('b0000000-0000-4000-8000-000000000002'),
  ('b0000000-0000-4000-8000-000000000003'),
  ('b0000000-0000-4000-8000-000000000004'),
  ('b0000000-0000-4000-8000-000000000005');
insert into public.organizations(id,name,slug) values
  ('b1000000-0000-4000-8000-000000000001','Roster Club','roster-club'),
  ('b1000000-0000-4000-8000-000000000002','Other Roster Club','other-roster-club');
insert into public.organization_members(organization_id,user_id,role,status) values
  ('b1000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000001','owner','active'),
  ('b1000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000002','member','active'),
  ('b1000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000003','member','active'),
  ('b1000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000004','member','active'),
  ('b1000000-0000-4000-8000-000000000002','b0000000-0000-4000-8000-000000000005','owner','active');
insert into public.tryouts(id,organization_id,name,slug,sport,timezone) values
  ('b2000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000001','Roster Tryout','roster-tryout','Hockey','America/Edmonton'),
  ('b2000000-0000-4000-8000-000000000002','b1000000-0000-4000-8000-000000000002','Other Tryout','other-roster-tryout','Hockey','America/Edmonton');
insert into public.tryout_divisions(id,organization_id,tryout_id,name,sort_order) values
  ('b3000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','U15',0),
  ('b3000000-0000-4000-8000-000000000002','b1000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','U17',1),
  ('b3000000-0000-4000-8000-000000000003','b1000000-0000-4000-8000-000000000002','b2000000-0000-4000-8000-000000000002','U15',0);
insert into public.tryout_sessions(id,organization_id,tryout_id,division_id,name,starts_at,ends_at,sort_order) values
  ('b3100000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','b3000000-0000-4000-8000-000000000001','Session',clock_timestamp()+interval '1 day',clock_timestamp()+interval '1 day 1 hour',0);
insert into public.tryout_staff_assignments(organization_id,user_id,role,scope_kind,tryout_id,division_id,session_id,granted_by_user_id) values
  ('b1000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000002','director','division','b2000000-0000-4000-8000-000000000001','b3000000-0000-4000-8000-000000000001',null,'b0000000-0000-4000-8000-000000000001'),
  ('b1000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000003','director','session','b2000000-0000-4000-8000-000000000001',null,'b3100000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000001'),
  ('b1000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000004','reviewer','division','b2000000-0000-4000-8000-000000000001','b3000000-0000-4000-8000-000000000001',null,'b0000000-0000-4000-8000-000000000001');
insert into public.registration_forms(id,organization_id,tryout_id,name) values
  ('b4000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','Form'),
  ('b4000000-0000-4000-8000-000000000002','b1000000-0000-4000-8000-000000000002','b2000000-0000-4000-8000-000000000002','Form');
insert into public.registration_form_versions(id,organization_id,tryout_id,registration_form_id,version_number,schema,status,published_at) values
  ('b4100000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','b4000000-0000-4000-8000-000000000001',1,'{"fields":[]}','published',clock_timestamp()),
  ('b4100000-0000-4000-8000-000000000002','b1000000-0000-4000-8000-000000000002','b2000000-0000-4000-8000-000000000002','b4000000-0000-4000-8000-000000000002',1,'{"fields":[]}','published',clock_timestamp());
insert into public.athletes(id,organization_id,given_name,family_name,normalized_given_name,normalized_family_name,birth_date) values
  ('b5000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000001','Ava','One','ava','one','2012-01-01'),
  ('b5000000-0000-4000-8000-000000000002','b1000000-0000-4000-8000-000000000001','Mia','Two','mia','two','2012-01-02'),
  ('b5000000-0000-4000-8000-000000000004','b1000000-0000-4000-8000-000000000001','Ivy','Four','ivy','four','2012-01-04'),
  ('b5000000-0000-4000-8000-000000000003','b1000000-0000-4000-8000-000000000002','Noa','Other','noa','other','2012-01-03');
insert into public.tryout_registrations(id,organization_id,tryout_id,athlete_id,division_id,registration_form_version_id,responses,submission_key_digest,submission_digest) values
  ('b6000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','b5000000-0000-4000-8000-000000000001','b3000000-0000-4000-8000-000000000001','b4100000-0000-4000-8000-000000000001','{}',repeat('a',64),repeat('1',64)),
  ('b6000000-0000-4000-8000-000000000002','b1000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','b5000000-0000-4000-8000-000000000002','b3000000-0000-4000-8000-000000000002','b4100000-0000-4000-8000-000000000001','{}',repeat('b',64),repeat('2',64)),
  ('b6000000-0000-4000-8000-000000000004','b1000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','b5000000-0000-4000-8000-000000000004','b3000000-0000-4000-8000-000000000001','b4100000-0000-4000-8000-000000000001','{}',repeat('d',64),repeat('4',64)),
  ('b6000000-0000-4000-8000-000000000003','b1000000-0000-4000-8000-000000000002','b2000000-0000-4000-8000-000000000002','b5000000-0000-4000-8000-000000000003','b3000000-0000-4000-8000-000000000003','b4100000-0000-4000-8000-000000000002','{}',repeat('c',64),repeat('3',64));
update public.tryouts set status='published',published_at=clock_timestamp()
where id in ('b2000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000002');
insert into public.tryout_teams(organization_id,tryout_id,division_id,name,sort_order)
values('b1000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','b3000000-0000-4000-8000-000000000002','U17 Team',0);

set local role authenticated;
select set_config('request.jwt.claim.sub','b0000000-0000-4000-8000-000000000001',true);
select is((select outcome from public.create_roster_draft(
  'b1000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','b3000000-0000-4000-8000-000000000001','{}'::jsonb
)),'invalid_teams','a non-array team payload is rejected without a database error');
select is((select outcome from public.create_roster_draft(
  'b1000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','b3000000-0000-4000-8000-000000000001','[1]'::jsonb
)),'invalid_teams','a scalar team entry is rejected without a database error');
select is((select outcome from public.create_roster_draft(
  'b1000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','b3000000-0000-4000-8000-000000000001','[{"targetSize":2}]'::jsonb
)),'invalid_teams','a team missing its name is rejected');
select is((select outcome from public.create_roster_draft(
  'b1000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','b3000000-0000-4000-8000-000000000001','[{"name":"Blue","targetSize":1.5}]'::jsonb
)),'invalid_teams','a fractional target is rejected');
create temporary table created as select * from public.create_roster_draft(
  'b1000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','b3000000-0000-4000-8000-000000000001',
  '[{"name":"Blue","targetSize":2,"positionTargets":{}},{"name":"White","targetSize":2,"positionTargets":{}}]'::jsonb
);
select is((select outcome from created),'created','an owner creates a draft and teams atomically');
select is((select version from created),1::bigint,'a draft begins at version one');
select is((select count(*) from public.roster_decisions where roster_version_id=(select roster_version_id from created)),2::bigint,'draft snapshots all active division registrations as undecided');

select is((select outcome from public.move_roster_athlete(
  'b1000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','b3000000-0000-4000-8000-000000000001',(select roster_version_id from created),
  'b6000000-0000-4000-8000-000000000001',(select id from public.tryout_teams where name='Blue'),1
)),'moved','an authorized draft placement succeeds');
select is((select status from public.roster_decisions where roster_version_id=(select roster_version_id from created) and registration_id='b6000000-0000-4000-8000-000000000001'),'undecided','placement does not imply a decision');
select is((select outcome from public.move_roster_athlete(
  'b1000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','b3000000-0000-4000-8000-000000000001',(select roster_version_id from created),
  'b6000000-0000-4000-8000-000000000002',(select id from public.tryout_teams where name='Blue'),2
)),'invalid_registration','wrong-division registration fails closed');
select is((select outcome from public.move_roster_athlete(
  'b1000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','b3000000-0000-4000-8000-000000000001',(select roster_version_id from created),
  'b6000000-0000-4000-8000-000000000003',(select id from public.tryout_teams where name='Blue'),2
)),'invalid_registration','cross-tenant registration fails without placement');
select is((select outcome from public.move_roster_athlete(
  'b1000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','b3000000-0000-4000-8000-000000000001',(select roster_version_id from created),
  'b6000000-0000-4000-8000-000000000001',(select id from public.tryout_teams where name='U17 Team'),2
)),'invalid_team','a known team from the wrong roster division is rejected');
select is((select outcome from public.change_roster_decisions(
  'b1000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','b3000000-0000-4000-8000-000000000001',(select roster_version_id from created),
  '{}'::jsonb,2,'CONFIRM DECISIONS'
)),'invalid_decisions','a non-array decision payload is rejected without a database error');
select is((select outcome from public.change_roster_decisions(
  'b1000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','b3000000-0000-4000-8000-000000000001',(select roster_version_id from created),
  '[1]'::jsonb,2,'CONFIRM DECISIONS'
)),'invalid_decisions','a scalar decision entry is rejected without a database error');
select is((select outcome from public.change_roster_decisions(
  'b1000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','b3000000-0000-4000-8000-000000000001',(select roster_version_id from created),
  '[{"registrationId":"b6000000-0000-4000-8000-000000000001"}]'::jsonb,2,'CONFIRM DECISIONS'
)),'invalid_decisions','a decision missing its status is rejected');
select is((select outcome from public.change_roster_decisions(
  'b1000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','b3000000-0000-4000-8000-000000000001',(select roster_version_id from created),
  '[{"registrationId":"b6000000-0000-4000-8000-000000000001","status":"selected"},{"registrationId":"b6000000-0000-4000-8000-000000000004","status":"waitlisted"}]',2,'CONFIRM DECISIONS'
)),'changed','confirmed bulk decisions change independently');
select is((select team_id from public.roster_assignments where roster_version_id=(select roster_version_id from created) and registration_id='b6000000-0000-4000-8000-000000000001'),(select id from public.tryout_teams where name='Blue'),'decision change preserves placement');
select is((select count(*) from public.decision_history where roster_version_id=(select roster_version_id from created)),2::bigint,'each bulk decision transition appends actor history');
select is((select outcome from public.finalize_roster_version(
  'b1000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','b3000000-0000-4000-8000-000000000001',(select roster_version_id from created),3,'yes'
)),'confirmation_required','finalization requires exact confirmation');
select is((select outcome from public.finalize_roster_version(
  'b1000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','b3000000-0000-4000-8000-000000000001',(select roster_version_id from created),3,'FINALIZE ROSTER'
)),'finalized','confirmed finalization atomically locks the version');
select is((select state from public.roster_versions where id=(select roster_version_id from created)),'finalized','finalized state is durable');
select ok((select finalized_by_user_id is not null and finalized_at is not null from public.roster_versions where id=(select roster_version_id from created)),'finalized actor and time are durable');
select is((select count(*) from public.audit_logs where action='roster.finalized' and entity_id=(select roster_version_id from created)),1::bigint,'finalization is audited');
select is((select outcome from public.move_roster_athlete(
  'b1000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','b3000000-0000-4000-8000-000000000001',(select roster_version_id from created),
  'b6000000-0000-4000-8000-000000000001',null,4
)),'invalid_state','finalized placement cannot mutate');

reset role;
select throws_ok(
  $$update public.roster_decisions set status='released' where roster_version_id=(select roster_version_id from created)$$,
  '55000',null,'even the table owner cannot mutate a finalized decision snapshot'
);
select throws_ok(
  $$update public.tryout_teams set name='Changed final team' where name='Blue'$$,
  '55000',null,'team definitions in a finalized snapshot are immutable'
);

set local role authenticated;
select set_config('request.jwt.claim.sub','b0000000-0000-4000-8000-000000000001',true);
create temporary table revised as select * from public.revise_roster_version(
  'b1000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','b3000000-0000-4000-8000-000000000001',(select roster_version_id from created),
  4,'Correcting the final roster after director review.','REVISE ROSTER'
);
select is((select outcome from revised),'revised','revision creates a new draft');
select is((select count(*) from public.roster_assignments where roster_version_id=(select roster_version_id from revised)),1::bigint,'revision clones placements');
select is((select status from public.roster_decisions where roster_version_id=(select roster_version_id from revised) and registration_id='b6000000-0000-4000-8000-000000000001'),'selected','revision clones decisions');
select is((select based_on_roster_version_id from public.roster_versions where id=(select roster_version_id from revised)),(select roster_version_id from created),'revision retains source lineage');
select is((select count(*) from public.audit_logs where action='roster.revised' and entity_id=(select roster_version_id from revised)),1::bigint,'revision is audited');

select set_config('request.jwt.claim.sub','b0000000-0000-4000-8000-000000000003',true);
select is((select outcome from public.move_roster_athlete(
  'b1000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','b3000000-0000-4000-8000-000000000001',(select roster_version_id from revised),
  'b6000000-0000-4000-8000-000000000001',(select id from public.tryout_teams where name='White'),1
)),'forbidden','a session-scoped director cannot widen authority to a division roster');
select set_config('request.jwt.claim.sub','b0000000-0000-4000-8000-000000000002',true);
select is((select outcome from public.move_roster_athlete(
  'b1000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','b3000000-0000-4000-8000-000000000001',(select roster_version_id from revised),
  'b6000000-0000-4000-8000-000000000001',(select id from public.tryout_teams where name='White'),1
)),'moved','an active exact-division director can edit the division draft');
reset role;
update public.organization_members set status='disabled' where organization_id='b1000000-0000-4000-8000-000000000001' and user_id='b0000000-0000-4000-8000-000000000002';
set local role authenticated;
select set_config('request.jwt.claim.sub','b0000000-0000-4000-8000-000000000002',true);
select is((select outcome from public.move_roster_athlete(
  'b1000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','b3000000-0000-4000-8000-000000000001',(select roster_version_id from revised),
  'b6000000-0000-4000-8000-000000000001',(select id from public.tryout_teams where name='Blue'),2
)),'forbidden','offboarding is rechecked at execution time');

select set_config('request.jwt.claim.sub','b0000000-0000-4000-8000-000000000004',true);
select is((select count(*) from public.roster_versions),1::bigint,'a reviewer sees only the finalized source snapshot, not the draft revision');
select is((select count(*) from public.roster_assignments),1::bigint,'a reviewer sees finalized placements through RLS');
select is((select outcome from public.move_roster_athlete(
  'b1000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','b3000000-0000-4000-8000-000000000001',(select roster_version_id from created),
  'b6000000-0000-4000-8000-000000000001',null,4
)),'forbidden','reviewer grants are read-only');

reset role;
select function_privs_are('public','move_roster_athlete',array['uuid','uuid','uuid','uuid','uuid','uuid','bigint'],'authenticated',array['EXECUTE'],'authenticated uses the guarded move RPC');
select function_privs_are('public','create_roster_draft',array['uuid','uuid','uuid','jsonb'],'authenticated',array['EXECUTE'],'authenticated uses the guarded create RPC');
select function_privs_are('public','change_roster_decisions',array['uuid','uuid','uuid','uuid','jsonb','bigint','text'],'authenticated',array['EXECUTE'],'authenticated uses the guarded decision RPC');
select function_privs_are('public','finalize_roster_version',array['uuid','uuid','uuid','uuid','bigint','text'],'authenticated',array['EXECUTE'],'authenticated uses the guarded finalize RPC');
select function_privs_are('public','revise_roster_version',array['uuid','uuid','uuid','uuid','bigint','text','text'],'authenticated',array['EXECUTE'],'authenticated uses the guarded revision RPC');
select function_privs_are('public','move_roster_athlete',array['uuid','uuid','uuid','uuid','uuid','uuid','bigint'],'service_role',array[]::text[],'service role cannot bypass actor-scoped writes');
select function_privs_are('public','create_roster_draft',array['uuid','uuid','uuid','jsonb'],'service_role',array[]::text[],'service role cannot create rosters');
select function_privs_are('public','change_roster_decisions',array['uuid','uuid','uuid','uuid','jsonb','bigint','text'],'service_role',array[]::text[],'service role cannot change decisions');
select function_privs_are('public','finalize_roster_version',array['uuid','uuid','uuid','uuid','bigint','text'],'service_role',array[]::text[],'service role cannot finalize rosters');
select function_privs_are('public','revise_roster_version',array['uuid','uuid','uuid','uuid','bigint','text','text'],'service_role',array[]::text[],'service role cannot revise rosters');
select function_privs_are('public','move_roster_athlete',array['uuid','uuid','uuid','uuid','uuid','uuid','bigint'],'anon',array[]::text[],'anonymous cannot move roster athletes');
select function_privs_are('public','create_roster_draft',array['uuid','uuid','uuid','jsonb'],'anon',array[]::text[],'anonymous cannot create rosters');
select function_privs_are('public','change_roster_decisions',array['uuid','uuid','uuid','uuid','jsonb','bigint','text'],'anon',array[]::text[],'anonymous cannot change decisions');
select function_privs_are('public','finalize_roster_version',array['uuid','uuid','uuid','uuid','bigint','text'],'anon',array[]::text[],'anonymous cannot finalize rosters');
select function_privs_are('public','revise_roster_version',array['uuid','uuid','uuid','uuid','bigint','text','text'],'anon',array[]::text[],'anonymous cannot revise rosters');
select function_privs_are('private','lock_and_can_manage_roster',array['uuid','uuid','uuid'],'authenticated',array[]::text[],'authenticated cannot execute the write authorization helper');
select function_privs_are('private','can_read_roster',array['uuid','uuid','uuid','boolean'],'authenticated',array['EXECUTE'],'the RLS read helper has only the required authenticated grant');
select table_privs_are('public','roster_assignments','authenticated',array['SELECT'],'authenticated receives read-only table access');
select table_privs_are('public','roster_assignments','service_role',array[]::text[],'service role receives no table privilege');
select table_privs_are('public','tryout_teams','authenticated',array['SELECT'],'authenticated receives read-only team access');
select table_privs_are('public','roster_versions','authenticated',array['SELECT'],'authenticated receives read-only roster version access');
select table_privs_are('public','roster_decisions','authenticated',array['SELECT'],'authenticated receives read-only decision access');
select table_privs_are('public','decision_history','authenticated',array['SELECT'],'authenticated receives read-only decision-history access');
select table_privs_are('public','tryout_teams','service_role',array[]::text[],'service role receives no team-table privilege');
select table_privs_are('public','roster_versions','service_role',array[]::text[],'service role receives no roster-version privilege');
select table_privs_are('public','roster_decisions','service_role',array[]::text[],'service role receives no decision privilege');
select table_privs_are('public','decision_history','service_role',array[]::text[],'service role receives no decision-history privilege');
select is(
  (select count(*) from pg_proc routine join pg_namespace namespace on namespace.oid=routine.pronamespace
    where namespace.nspname='public' and routine.proname=any(array['create_roster_draft','move_roster_athlete','change_roster_decisions','finalize_roster_version','revise_roster_version'])
      and routine.prosecdef and routine.proconfig=array['search_path=""']::text[]),
  5::bigint,'every roster write RPC is security definer with an empty search path'
);

select * from finish();
rollback;
