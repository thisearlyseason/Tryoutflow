begin;
select plan(5);

insert into auth.users(id) values('71000000-0000-4000-8000-000000000001');
insert into public.organizations(id,name,slug,timezone) values
  ('71000000-0000-4000-8000-000000000002','Wizard Local Time Club','wizard-local-time-club','America/Edmonton');
insert into public.organization_members(organization_id,user_id,role,status) values
  ('71000000-0000-4000-8000-000000000002','71000000-0000-4000-8000-000000000001','owner','active');
insert into public.tryouts(id,organization_id,name,slug,sport,timezone,status) values
  ('71000000-0000-4000-8000-000000000003','71000000-0000-4000-8000-000000000002','Wizard Local Tryout','wizard-local-tryout','Hockey','America/Edmonton','draft');
insert into public.tryout_divisions(id,organization_id,tryout_id,name,sort_order) values
  ('71000000-0000-4000-8000-000000000004','71000000-0000-4000-8000-000000000002','71000000-0000-4000-8000-000000000003','U15',0);

set local role authenticated;
select set_config('request.jwt.claim.sub','71000000-0000-4000-8000-000000000001',true);

select is(
  (select outcome from public.save_tryout_wizard_configuration(
    '71000000-0000-4000-8000-000000000002',
    '71000000-0000-4000-8000-000000000003',
    'basics',
    '{"name":"Wizard Local Tryout","sport":"Hockey","timezone":"America/Edmonton","registrationStartsAt":"2026-09-01T08:00","registrationEndsAt":"2026-09-30T20:00"}'::jsonb
  )),
  'saved',
  'the RPC accepts browser-local registration wall times'
);
select is(
  (select registration_starts_at from public.tryouts where id='71000000-0000-4000-8000-000000000003'),
  '2026-09-01 14:00:00+00'::timestamptz,
  'the registration opening is interpreted in America/Edmonton'
);
select is(
  (select outcome from public.save_tryout_wizard_configuration(
    '71000000-0000-4000-8000-000000000002',
    '71000000-0000-4000-8000-000000000003',
    'sessions',
    '{"divisionId":"71000000-0000-4000-8000-000000000004","name":"Skills session","startsAt":"2026-10-01T16:00","endsAt":"2026-10-01T18:00","groupName":"","positionName":"Forward"}'::jsonb
  )),
  'saved',
  'the RPC accepts browser-local session wall times'
);
select is(
  (select starts_at from public.tryout_sessions where organization_id='71000000-0000-4000-8000-000000000002'),
  '2026-10-01 22:00:00+00'::timestamptz,
  'the session start is interpreted in the persisted tryout timezone'
);
select is(
  (select ends_at from public.tryout_sessions where organization_id='71000000-0000-4000-8000-000000000002'),
  '2026-10-02 00:00:00+00'::timestamptz,
  'the session end is interpreted in the persisted tryout timezone'
);

select * from finish();
rollback;
