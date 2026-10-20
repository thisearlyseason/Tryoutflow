begin;
select no_plan();

insert into auth.users(id) values ('e0000000-0000-4000-8000-000000000001');
insert into public.organizations(id,name,slug)
values ('e1000000-0000-4000-8000-000000000001','Roster Truncate Club','roster-truncate-club');
insert into public.organization_members(organization_id,user_id,role,status)
values ('e1000000-0000-4000-8000-000000000001','e0000000-0000-4000-8000-000000000001','owner','active');
insert into public.tryouts(id,organization_id,name,slug,sport,timezone)
values ('e2000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000001','Roster Truncate Tryout','roster-truncate-tryout','Hockey','America/Edmonton');
insert into public.tryout_divisions(id,organization_id,tryout_id,name,sort_order)
values ('e3000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000001','U15',0);
insert into public.registration_forms(id,organization_id,tryout_id,name)
values ('e4000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000001','Form');
insert into public.registration_form_versions(id,organization_id,tryout_id,registration_form_id,version_number,schema,status,published_at)
values ('e4100000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000001','e4000000-0000-4000-8000-000000000001',1,'{"fields":[]}','published',clock_timestamp());
insert into public.athletes(id,organization_id,given_name,family_name,normalized_given_name,normalized_family_name,birth_date)
values ('e5000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000001','Ava','One','ava','one','2012-01-01');
insert into public.tryout_registrations(id,organization_id,tryout_id,athlete_id,division_id,registration_form_version_id,responses,submission_key_digest,submission_digest)
values ('e6000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000001','e5000000-0000-4000-8000-000000000001','e3000000-0000-4000-8000-000000000001','e4100000-0000-4000-8000-000000000001','{}',repeat('a',64),repeat('1',64));
update public.tryouts set status='published',published_at=clock_timestamp()
where id='e2000000-0000-4000-8000-000000000001';

set local role authenticated;
select set_config('request.jwt.claim.sub','e0000000-0000-4000-8000-000000000001',true);
create temporary table target_roster as select * from public.create_roster_draft(
  'e1000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000001','e3000000-0000-4000-8000-000000000001','[{"name":"Blue"}]'
);
select public.move_roster_athlete(
  'e1000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000001','e3000000-0000-4000-8000-000000000001',(select roster_version_id from target_roster),
  'e6000000-0000-4000-8000-000000000001',(select id from public.tryout_teams where organization_id='e1000000-0000-4000-8000-000000000001'),1
);
select public.change_roster_decisions(
  'e1000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000001','e3000000-0000-4000-8000-000000000001',(select roster_version_id from target_roster),
  '[{"registrationId":"e6000000-0000-4000-8000-000000000001","status":"selected"}]',2,'CONFIRM DECISIONS'
);
select public.finalize_roster_version(
  'e1000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000001','e3000000-0000-4000-8000-000000000001',(select roster_version_id from target_roster),3,'FINALIZE ROSTER'
);
reset role;

select has_trigger('public','roster_assignments','deny_roster_assignments_truncate','roster assignments have a statement-level truncate guard');
select has_trigger('public','roster_decisions','deny_roster_decisions_truncate','roster decisions have a statement-level truncate guard');
select has_trigger('public','decision_history','deny_decision_history_truncate','decision history has a statement-level truncate guard');
select has_trigger('public','roster_versions','deny_roster_versions_truncate','roster versions have a statement-level truncate guard');
select has_trigger('public','tryout_teams','deny_tryout_teams_truncate','tryout teams have a statement-level truncate guard');

select throws_ok('truncate table public.roster_assignments','55000',null,'table owner cannot truncate finalized roster assignments');
select throws_ok('truncate table public.roster_decisions cascade','55000',null,'table owner cannot truncate finalized roster decisions');
select throws_ok('truncate table public.decision_history','55000',null,'table owner cannot truncate finalized decision history');
select throws_ok('truncate table public.roster_versions cascade','55000',null,'table owner cannot truncate finalized roster versions');
select throws_ok('truncate table public.tryout_teams cascade','55000',null,'table owner cannot truncate teams referenced by finalized rosters');

set session_replication_role=replica;
select throws_ok('truncate table public.roster_assignments','55000',null,'replica mode cannot bypass roster assignment truncate protection');
select throws_ok('truncate table public.roster_decisions cascade','55000',null,'replica mode cannot bypass roster decision truncate protection');
select throws_ok('truncate table public.decision_history','55000',null,'replica mode cannot bypass decision history truncate protection');
select throws_ok('truncate table public.roster_versions cascade','55000',null,'replica mode cannot bypass roster version truncate protection');
select throws_ok('truncate table public.tryout_teams cascade','55000',null,'replica mode cannot bypass roster team truncate protection');
set session_replication_role=origin;

select is(
  (select count(*) from unnest(array['anon','authenticated','service_role']) role_name
    cross join unnest(array['tryout_teams','roster_versions','roster_assignments','roster_decisions','decision_history']) table_name
    cross join unnest(array['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) privilege_name
    where has_table_privilege(role_name,format('public.%I',table_name),privilege_name)),
  0::bigint,
  'client roles have no unsafe roster-table privileges'
);

select * from finish();
rollback;
