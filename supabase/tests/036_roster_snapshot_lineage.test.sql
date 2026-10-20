begin;
select no_plan();

insert into auth.users(id) values ('d0000000-0000-4000-8000-000000000001');
insert into public.organizations(id,name,slug)
values ('d1000000-0000-4000-8000-000000000001','Roster Fix Club','roster-fix-club');
insert into public.organization_members(organization_id,user_id,role,status)
values ('d1000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-000000000001','owner','active');
insert into public.tryouts(id,organization_id,name,slug,sport,timezone)
values ('d2000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000001','Roster Fix Tryout','roster-fix-tryout','Hockey','America/Edmonton');
insert into public.tryout_divisions(id,organization_id,tryout_id,name,sort_order)
values ('d3000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000001','U15',0);
insert into public.registration_forms(id,organization_id,tryout_id,name)
values ('d4000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000001','Form');
insert into public.registration_form_versions(id,organization_id,tryout_id,registration_form_id,version_number,schema,status,published_at)
values ('d4100000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000001','d4000000-0000-4000-8000-000000000001',1,'{"fields":[]}','published',clock_timestamp());
insert into public.athletes(id,organization_id,given_name,family_name,normalized_given_name,normalized_family_name,birth_date) values
  ('d5000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000001','Ava','One','ava','one','2012-01-01'),
  ('d5000000-0000-4000-8000-000000000002','d1000000-0000-4000-8000-000000000001','Mia','Late','mia','late','2012-01-02');
insert into public.tryout_registrations(id,organization_id,tryout_id,athlete_id,division_id,registration_form_version_id,responses,submission_key_digest,submission_digest)
values ('d6000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000001','d5000000-0000-4000-8000-000000000001','d3000000-0000-4000-8000-000000000001','d4100000-0000-4000-8000-000000000001','{}',repeat('a',64),repeat('1',64));
update public.tryouts set status='published',published_at=clock_timestamp() where id='d2000000-0000-4000-8000-000000000001';

set local role authenticated;
select set_config('request.jwt.claim.sub','d0000000-0000-4000-8000-000000000001',true);
create temporary table initial_roster as select * from public.create_roster_draft(
  'd1000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000001','d3000000-0000-4000-8000-000000000001','[{"name":"Blue"}]'
);
select is((select outcome from public.move_roster_athlete(
  'd1000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000001','d3000000-0000-4000-8000-000000000001',(select roster_version_id from initial_roster),
  'd6000000-0000-4000-8000-000000000001',(select id from public.tryout_teams where organization_id='d1000000-0000-4000-8000-000000000001'),1
)),'moved','fixture placement succeeds');
select is((select outcome from public.change_roster_decisions(
  'd1000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000001','d3000000-0000-4000-8000-000000000001',(select roster_version_id from initial_roster),
  '[{"registrationId":"d6000000-0000-4000-8000-000000000001","status":"selected"}]',2,'CONFIRM DECISIONS'
)),'changed','fixture decision history succeeds');
select is((select outcome from public.finalize_roster_version(
  'd1000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000001','d3000000-0000-4000-8000-000000000001',(select roster_version_id from initial_roster),3,'FINALIZE ROSTER'
)),'finalized','fixture finalization succeeds');

create temporary table first_revision as select * from public.revise_roster_version(
  'd1000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000001','d3000000-0000-4000-8000-000000000001',(select roster_version_id from initial_roster),
  4,'Correcting the first finalized snapshot.','REVISE ROSTER'
);
select is((select outcome from first_revision),'revised','revision accepts the exact finalized source version');

reset role;
insert into public.tryout_registrations(id,organization_id,tryout_id,athlete_id,division_id,registration_form_version_id,responses,submission_key_digest,submission_digest)
values ('d6000000-0000-4000-8000-000000000002','d1000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000001','d5000000-0000-4000-8000-000000000002','d3000000-0000-4000-8000-000000000001','d4100000-0000-4000-8000-000000000001','{}',repeat('b',64),repeat('2',64));

set local role authenticated;
select set_config('request.jwt.claim.sub','d0000000-0000-4000-8000-000000000001',true);
select is((select outcome from public.move_roster_athlete(
  'd1000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000001','d3000000-0000-4000-8000-000000000001',(select roster_version_id from first_revision),
  'd6000000-0000-4000-8000-000000000002',(select id from public.tryout_teams where organization_id='d1000000-0000-4000-8000-000000000001'),1
)),'invalid_registration','a registration created after the draft snapshot cannot be placed');
select is((select version from public.roster_versions where id=(select roster_version_id from first_revision)),1::bigint,'late placement rejection does not advance the roster version');
select is((select count(*) from public.roster_assignments where roster_version_id=(select roster_version_id from first_revision)),1::bigint,'late placement rejection leaves cloned assignments unchanged');
select is((select count(*) from public.roster_decisions where roster_version_id=(select roster_version_id from first_revision)),1::bigint,'late placement rejection does not add a decision');
select is((select count(*) from public.decision_history where roster_version_id=(select roster_version_id from first_revision)),0::bigint,'late placement rejection does not add decision history');
select is((select count(*) from public.audit_logs where entity_id=(select roster_version_id from first_revision) and action='roster.athlete_moved'),0::bigint,'late placement rejection is audit-side-effect free');

select is((select outcome from public.finalize_roster_version(
  'd1000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000001','d3000000-0000-4000-8000-000000000001',(select roster_version_id from first_revision),1,'FINALIZE ROSTER'
)),'finalized','the first revision can be finalized');
select is((select outcome from public.revise_roster_version(
  'd1000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000001','d3000000-0000-4000-8000-000000000001',(select roster_version_id from initial_roster),
  4,'Attempting to fork an older finalized snapshot.','REVISE ROSTER'
)),'conflict','an older finalized lineage source cannot fork a new draft');
select is((select outcome from public.revise_roster_version(
  'd1000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000001','d3000000-0000-4000-8000-000000000001',(select roster_version_id from first_revision),
  1,'Attempting revision from a stale browser version.','REVISE ROSTER'
)),'conflict','revision rejects a stale finalized source version');

reset role;
select throws_ok(
  format($sql$insert into public.roster_assignments(organization_id,tryout_id,division_id,roster_version_id,registration_id,team_id,assigned_by_user_id)
    values('d1000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000001','d3000000-0000-4000-8000-000000000001',%L,'d6000000-0000-4000-8000-000000000001',%L,'d0000000-0000-4000-8000-000000000001')$sql$,
    (select roster_version_id from initial_roster),(select id from public.tryout_teams where organization_id='d1000000-0000-4000-8000-000000000001')),
  '55000',null,'a finalized snapshot cannot gain an assignment child'
);
select throws_ok(
  format('update public.roster_assignments set roster_version_id=%L where roster_version_id=%L',
    (select roster_version_id from first_revision),(select roster_version_id from initial_roster)),
  '55000',null,'a finalized assignment cannot be reparented into a draft'
);
select throws_ok(
  format('update public.roster_decisions set roster_version_id=%L where roster_version_id=%L',
    (select roster_version_id from first_revision),(select roster_version_id from initial_roster)),
  '55000',null,'a finalized decision cannot be reparented into a draft'
);
select throws_ok(
  format('update public.roster_decisions set status=''released'' where roster_version_id=%L',(select roster_version_id from initial_roster)),
  '55000',null,'a finalized decision cannot mutate in place'
);
select throws_ok(
  format('delete from public.roster_assignments where roster_version_id=%L',(select roster_version_id from initial_roster)),
  '55000',null,'a finalized assignment cannot be deleted'
);
select throws_ok(
  format('delete from public.roster_decisions where roster_version_id=%L',(select roster_version_id from initial_roster)),
  '55000',null,'a finalized decision cannot be deleted'
);
select throws_ok(
  $$insert into public.tryout_teams(organization_id,tryout_id,division_id,name,sort_order)
    values('d1000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000001','d3000000-0000-4000-8000-000000000001','Late Team',20)$$,
  '55000',null,'a finalized roster scope cannot gain a team'
);
select throws_ok(
  $$update public.tryout_teams set name='Changed Team' where organization_id='d1000000-0000-4000-8000-000000000001'$$,
  '55000',null,'a finalized roster scope cannot mutate a team'
);
select throws_ok(
  $$delete from public.tryout_teams where organization_id='d1000000-0000-4000-8000-000000000001'$$,
  '55000',null,'a finalized roster scope cannot lose a team'
);
select throws_ok(
  format($sql$insert into public.roster_decisions(organization_id,tryout_id,division_id,roster_version_id,registration_id)
    values('d1000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000001','d3000000-0000-4000-8000-000000000001',%L,'d6000000-0000-4000-8000-000000000002')$sql$,
    (select roster_version_id from initial_roster)),
  '55000',null,'a finalized snapshot cannot gain a decision child'
);
select throws_ok(
  format($sql$insert into public.decision_history(organization_id,tryout_id,division_id,roster_version_id,registration_id,from_status,to_status,actor_user_id)
    values('d1000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000001','d3000000-0000-4000-8000-000000000001',%L,'d6000000-0000-4000-8000-000000000001','undecided','selected','d0000000-0000-4000-8000-000000000001')$sql$,
    (select roster_version_id from initial_roster)),
  '55000',null,'a finalized snapshot cannot gain history children'
);
select throws_ok(
  format('update public.decision_history set to_status=''released'' where roster_version_id=%L',(select roster_version_id from initial_roster)),
  '55000',null,'finalized decision history remains append-only'
);
select throws_ok(
  format('delete from public.decision_history where roster_version_id=%L',(select roster_version_id from initial_roster)),
  '55000',null,'finalized decision history cannot be deleted'
);

set session_replication_role=replica;
select throws_ok(
  format('update public.roster_assignments set team_id=team_id where roster_version_id=%L',(select roster_version_id from initial_roster)),
  '55000',null,'finalized assignment guards remain active for privileged trigger-bypass mode'
);
select throws_ok(
  $$insert into public.tryout_teams(organization_id,tryout_id,division_id,name,sort_order)
    values('d1000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000001','d3000000-0000-4000-8000-000000000001','Replica Team',21)$$,
  '55000',null,'finalized team guards remain active for privileged trigger-bypass mode'
);
set session_replication_role=origin;

select function_privs_are('public','revise_roster_version',array['uuid','uuid','uuid','uuid','bigint','text','text'],'authenticated',array['EXECUTE'],'authenticated revision RPC requires expected source version');
select hasnt_function('public','revise_roster_version',array['uuid','uuid','uuid','uuid','text','text'],'the unversioned revision RPC is removed');

select * from finish();
rollback;
