begin;
select no_plan();

insert into auth.users(id) values('70000000-0000-4000-8000-000000000001');
insert into public.organizations(id,name,slug,timezone) values
  ('70000000-0000-4000-8000-000000000002','Wizard Regression Club','wizard-regression-club','America/Edmonton');
insert into public.organization_members(organization_id,user_id,role,status) values
  ('70000000-0000-4000-8000-000000000002','70000000-0000-4000-8000-000000000001','owner','active');
insert into public.tryouts(id,organization_id,name,slug,sport,timezone,status) values
  ('70000000-0000-4000-8000-000000000003','70000000-0000-4000-8000-000000000002','Wizard Tryout','wizard-tryout','Hockey','America/Edmonton','draft');
insert into public.tryout_divisions(id,organization_id,tryout_id,name,sort_order) values
  ('70000000-0000-4000-8000-000000000004','70000000-0000-4000-8000-000000000002','70000000-0000-4000-8000-000000000003','U15',0);

set local role authenticated;
select set_config('request.jwt.claim.sub','70000000-0000-4000-8000-000000000001',true);

select is(
  (select outcome from public.save_tryout_wizard_configuration(
    '70000000-0000-4000-8000-000000000002',
    '70000000-0000-4000-8000-000000000003',
    'sessions',
    jsonb_build_object(
      'divisionId','70000000-0000-4000-8000-000000000004',
      'name','Skills session',
      'startsAt','2026-10-01T22:00:00Z',
      'endsAt','2026-10-02T00:00:00Z',
      'groupName','',
      'positionName','Forward'
    )
  )),
  'saved',
  'the authenticated wizard saves a session without an ambiguous division reference'
);
select is(
  (select count(*) from public.tryout_sessions where
    organization_id='70000000-0000-4000-8000-000000000002'
    and tryout_id='70000000-0000-4000-8000-000000000003'
    and division_id='70000000-0000-4000-8000-000000000004'),
  1::bigint,
  'the saved session remains scoped to the selected division'
);

reset role;
select function_privs_are(
  'public','save_tryout_wizard_configuration',array['uuid','uuid','text','jsonb'],
  'authenticated',array['EXECUTE'],
  'the repaired wizard boundary retains its authenticated-only execute grant'
);

select * from finish();
rollback;
