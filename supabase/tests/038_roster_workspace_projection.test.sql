begin;
select no_plan();

insert into auth.users(id) values
  ('f0000000-0000-4000-8000-000000000001'),
  ('f0000000-0000-4000-8000-000000000002'),
  ('f0000000-0000-4000-8000-000000000003');
insert into public.organizations(id,name,slug)
values ('f1000000-0000-4000-8000-000000000001','Roster Workspace Club','roster-workspace-club');
insert into public.organization_members(organization_id,user_id,role,status) values
  ('f1000000-0000-4000-8000-000000000001','f0000000-0000-4000-8000-000000000001','owner','active'),
  ('f1000000-0000-4000-8000-000000000001','f0000000-0000-4000-8000-000000000002','member','active'),
  ('f1000000-0000-4000-8000-000000000001','f0000000-0000-4000-8000-000000000003','member','active');
insert into public.tryouts(id,organization_id,name,slug,sport,timezone)
values ('f2000000-0000-4000-8000-000000000001','f1000000-0000-4000-8000-000000000001','Roster Workspace Tryout','roster-workspace-tryout','Hockey','America/Edmonton');
insert into public.tryout_divisions(id,organization_id,tryout_id,name,sort_order) values
  ('f3000000-0000-4000-8000-000000000001','f1000000-0000-4000-8000-000000000001','f2000000-0000-4000-8000-000000000001','U15',0),
  ('f3000000-0000-4000-8000-000000000002','f1000000-0000-4000-8000-000000000001','f2000000-0000-4000-8000-000000000001','U17',1);
insert into public.tryout_positions(id,organization_id,tryout_id,name,sort_order)
values ('f3100000-0000-4000-8000-000000000001','f1000000-0000-4000-8000-000000000001','f2000000-0000-4000-8000-000000000001','Forward',0);
insert into public.tryout_staff_assignments(id,organization_id,tryout_id,user_id,role,scope_kind,division_id,granted_by_user_id) values
  ('f3200000-0000-4000-8000-000000000001','f1000000-0000-4000-8000-000000000001','f2000000-0000-4000-8000-000000000001','f0000000-0000-4000-8000-000000000002','reviewer','division','f3000000-0000-4000-8000-000000000001','f0000000-0000-4000-8000-000000000001'),
  ('f3200000-0000-4000-8000-000000000002','f1000000-0000-4000-8000-000000000001','f2000000-0000-4000-8000-000000000001','f0000000-0000-4000-8000-000000000003','reviewer','division','f3000000-0000-4000-8000-000000000002','f0000000-0000-4000-8000-000000000001');
insert into public.registration_forms(id,organization_id,tryout_id,name)
values ('f4000000-0000-4000-8000-000000000001','f1000000-0000-4000-8000-000000000001','f2000000-0000-4000-8000-000000000001','Form');
insert into public.registration_form_versions(id,organization_id,tryout_id,registration_form_id,version_number,schema,status,published_at)
values ('f4100000-0000-4000-8000-000000000001','f1000000-0000-4000-8000-000000000001','f2000000-0000-4000-8000-000000000001','f4000000-0000-4000-8000-000000000001',1,'{"fields":[]}','published',clock_timestamp());
insert into public.athletes(id,organization_id,given_name,family_name,normalized_given_name,normalized_family_name,birth_date) values
  ('f5000000-0000-4000-8000-000000000001','f1000000-0000-4000-8000-000000000001','Ava','Enrolled','ava','enrolled','2012-01-01'),
  ('f5000000-0000-4000-8000-000000000002','f1000000-0000-4000-8000-000000000001','Mia','Snapshot','mia','snapshot','2012-01-02');
insert into public.tryout_registrations(id,organization_id,tryout_id,athlete_id,division_id,position_id,registration_form_version_id,responses,submission_key_digest,submission_digest) values
  ('f6000000-0000-4000-8000-000000000001','f1000000-0000-4000-8000-000000000001','f2000000-0000-4000-8000-000000000001','f5000000-0000-4000-8000-000000000001','f3000000-0000-4000-8000-000000000001','f3100000-0000-4000-8000-000000000001','f4100000-0000-4000-8000-000000000001','{}',repeat('a',64),repeat('1',64)),
  ('f6000000-0000-4000-8000-000000000002','f1000000-0000-4000-8000-000000000001','f2000000-0000-4000-8000-000000000001','f5000000-0000-4000-8000-000000000002','f3000000-0000-4000-8000-000000000001',null,'f4100000-0000-4000-8000-000000000001','{}',repeat('b',64),repeat('2',64));
update public.tryouts set status='published',published_at=clock_timestamp()
where id='f2000000-0000-4000-8000-000000000001';

set local role authenticated;
select set_config('request.jwt.claim.sub','f0000000-0000-4000-8000-000000000001',true);
create temporary table workspace_roster as select * from public.create_roster_draft(
  'f1000000-0000-4000-8000-000000000001','f2000000-0000-4000-8000-000000000001','f3000000-0000-4000-8000-000000000001','[{"name":"Blue","targetSize":18,"positionTargets":{"f3100000-0000-4000-8000-000000000001":10}}]'
);

select is(
  (select result->>'outcome' from public.load_roster_workspace(
    'f1000000-0000-4000-8000-000000000001','f2000000-0000-4000-8000-000000000001','f3000000-0000-4000-8000-000000000001',(select roster_version_id from workspace_roster))),
  'ok','owner can load exact draft workspace'
);
select is(
  (select jsonb_array_length(result#>'{snapshot,members}') from public.load_roster_workspace(
    'f1000000-0000-4000-8000-000000000001','f2000000-0000-4000-8000-000000000001','f3000000-0000-4000-8000-000000000001',(select roster_version_id from workspace_roster))),
  2,'projection retains submitted snapshot members without requiring session enrollment'
);
select is(
  (select result#>>'{snapshot,members,1,displayName}' from public.load_roster_workspace(
    'f1000000-0000-4000-8000-000000000001','f2000000-0000-4000-8000-000000000001','f3000000-0000-4000-8000-000000000001',(select roster_version_id from workspace_roster))),
  'Mia Snapshot','projection provides minimum roster identity independently of ranking eligibility'
);
select ok(
  (select result::text not like '%birth_date%' and result::text not like '%2012-01-%' from public.load_roster_workspace(
    'f1000000-0000-4000-8000-000000000001','f2000000-0000-4000-8000-000000000001','f3000000-0000-4000-8000-000000000001',(select roster_version_id from workspace_roster))),
  'projection does not expose extra athlete PII'
);

select set_config('request.jwt.claim.sub','f0000000-0000-4000-8000-000000000002',true);
select is(
  (select result->>'outcome' from public.load_roster_workspace(
    'f1000000-0000-4000-8000-000000000001','f2000000-0000-4000-8000-000000000001','f3000000-0000-4000-8000-000000000001',(select roster_version_id from workspace_roster))),
  'forbidden','reviewer cannot read a draft roster'
);

select set_config('request.jwt.claim.sub','f0000000-0000-4000-8000-000000000001',true);
select public.finalize_roster_version(
  'f1000000-0000-4000-8000-000000000001','f2000000-0000-4000-8000-000000000001','f3000000-0000-4000-8000-000000000001',(select roster_version_id from workspace_roster),1,'FINALIZE ROSTER'
);
select set_config('request.jwt.claim.sub','f0000000-0000-4000-8000-000000000002',true);
select is(
  (select result->>'outcome' from public.load_roster_workspace(
    'f1000000-0000-4000-8000-000000000001','f2000000-0000-4000-8000-000000000001','f3000000-0000-4000-8000-000000000001',(select roster_version_id from workspace_roster))),
  'ok','exact-division reviewer can read a finalized roster snapshot'
);
select set_config('request.jwt.claim.sub','f0000000-0000-4000-8000-000000000003',true);
select is(
  (select result->>'outcome' from public.load_roster_workspace(
    'f1000000-0000-4000-8000-000000000001','f2000000-0000-4000-8000-000000000001','f3000000-0000-4000-8000-000000000001',(select roster_version_id from workspace_roster))),
  'forbidden','foreign-division reviewer cannot read the finalized roster'
);

select set_config('request.jwt.claim.sub','f0000000-0000-4000-8000-000000000001',true);
create temporary table revised_roster as select * from public.revise_roster_version(
  'f1000000-0000-4000-8000-000000000001','f2000000-0000-4000-8000-000000000001','f3000000-0000-4000-8000-000000000001',(select roster_version_id from workspace_roster),2,'Correcting a confirmed roster placement.','REVISE ROSTER'
);
select public.move_roster_athlete(
  'f1000000-0000-4000-8000-000000000001','f2000000-0000-4000-8000-000000000001','f3000000-0000-4000-8000-000000000001',(select roster_version_id from revised_roster),
  'f6000000-0000-4000-8000-000000000001',(select id from public.tryout_teams where organization_id='f1000000-0000-4000-8000-000000000001'),1
);
select is(
  (select outcome from public.move_roster_athlete(
    'f1000000-0000-4000-8000-000000000001','f2000000-0000-4000-8000-000000000001','f3000000-0000-4000-8000-000000000001',(select roster_version_id from workspace_roster),
    'f6000000-0000-4000-8000-000000000002',(select id from public.tryout_teams where organization_id='f1000000-0000-4000-8000-000000000001'),2)),
  'invalid_state','stale old revision with the same numeric version cannot mutate the current revision'
);
select is(
  (select count(*) from public.roster_assignments where roster_version_id=(select roster_version_id from revised_roster)),
  1::bigint,'stale old-revision command has no mutation side effect'
);
select is(
  (select outcome from public.change_roster_decisions(
    'f1000000-0000-4000-8000-000000000001','f2000000-0000-4000-8000-000000000001','f3000000-0000-4000-8000-000000000001',(select roster_version_id from workspace_roster),
    '[{"registrationId":"f6000000-0000-4000-8000-000000000002","status":"selected"}]',2,'CONFIRM DECISIONS')),
  'invalid_state','stale old revision cannot apply bulk decisions to the current numeric version'
);
select is(
  (select outcome from public.finalize_roster_version(
    'f1000000-0000-4000-8000-000000000001','f2000000-0000-4000-8000-000000000001','f3000000-0000-4000-8000-000000000001',(select roster_version_id from workspace_roster),2,'FINALIZE ROSTER')),
  'invalid_state','stale old revision cannot finalize the current numeric version'
);
select is(
  (select outcome from public.revise_roster_version(
    'f1000000-0000-4000-8000-000000000001','f2000000-0000-4000-8000-000000000001','f3000000-0000-4000-8000-000000000001',(select roster_version_id from workspace_roster),2,'Another stale correction request.','REVISE ROSTER')),
  'conflict','stale multi-tab revision cannot fork while the exact latest draft exists'
);
select is(
  (select count(*) from public.roster_versions where organization_id='f1000000-0000-4000-8000-000000000001'),
  2::bigint,'stale move, decision, finalization, and revision probes create no extra lineage'
);

reset role;
select ok(has_function_privilege('authenticated','public.load_roster_workspace(uuid,uuid,uuid,uuid)','execute'),'authenticated users may call the guarded roster projection');
select ok(not has_function_privilege('anon','public.load_roster_workspace(uuid,uuid,uuid,uuid)','execute'),'anonymous users cannot call the roster projection');
select ok(not has_function_privilege('service_role','public.load_roster_workspace(uuid,uuid,uuid,uuid)','execute'),'service role cannot bypass actor authorization');

select * from finish();
rollback;
