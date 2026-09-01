begin;

set local search_path=extensions,public;
select plan(20);

select has_column('public','tryout_registrations','staff_request_digest','staff registration evidence stores a canonical request digest');

insert into auth.users(id,email,email_confirmed_at)
values('95000000-0000-4000-8000-000000000001','staff-owner@example.test',clock_timestamp());
insert into public.organizations(id,name,slug)
values('95100000-0000-4000-8000-000000000001','Staff Integrity','staff-integrity');
insert into public.organization_members(organization_id,user_id,role,status)
values('95100000-0000-4000-8000-000000000001','95000000-0000-4000-8000-000000000001','owner','active');
insert into public.tryouts(id,organization_id,name,slug,sport,timezone)
values('95200000-0000-4000-8000-000000000001','95100000-0000-4000-8000-000000000001','Staff Tryout','staff-tryout','Hockey','America/Edmonton');
insert into public.tryout_divisions(id,organization_id,tryout_id,name,sort_order)
values('95300000-0000-4000-8000-000000000001','95100000-0000-4000-8000-000000000001','95200000-0000-4000-8000-000000000001','U13',0);
insert into public.registration_forms(id,organization_id,tryout_id,name)
values('95400000-0000-4000-8000-000000000001','95100000-0000-4000-8000-000000000001','95200000-0000-4000-8000-000000000001','Staff form');
insert into public.registration_form_versions(
  id,organization_id,tryout_id,registration_form_id,version_number,schema,status
) values(
  '95500000-0000-4000-8000-000000000001','95100000-0000-4000-8000-000000000001',
  '95200000-0000-4000-8000-000000000001','95400000-0000-4000-8000-000000000001',1,
  '{"fields":[
    {"key":"consent","label":"I consent","kind":"consent","required":true,"sortOrder":0},
    {"key":"position","label":"Position","kind":"select","required":true,"sortOrder":1,"options":["Goalie","Skater"]},
    {"key":"email","label":"Email","kind":"email","required":true,"sortOrder":2},
    {"key":"phone","label":"Phone","kind":"phone","required":true,"sortOrder":3},
    {"key":"date","label":"Date","kind":"date","required":true,"sortOrder":4},
    {"key":"note","label":"Note","kind":"text","required":false,"sortOrder":5}
  ]}'::jsonb,'draft'
);
insert into public.tryout_registration_form_selections(
  organization_id,tryout_id,registration_form_version_id
) values(
  '95100000-0000-4000-8000-000000000001','95200000-0000-4000-8000-000000000001',
  '95500000-0000-4000-8000-000000000001'
);
insert into public.athletes(
  id,organization_id,given_name,family_name,normalized_given_name,normalized_family_name,birth_date
) values(
  '95600000-0000-4000-8000-000000000001','95100000-0000-4000-8000-000000000001',
  'Legacy','Athlete','legacy','athlete','2014-01-02'
);
insert into public.tryout_registrations(
  id,organization_id,tryout_id,athlete_id,division_id,registration_form_version_id,
  responses,source,submission_key_digest,submission_digest
) values(
  '95700000-0000-4000-8000-000000000001','95100000-0000-4000-8000-000000000001',
  '95200000-0000-4000-8000-000000000001','95600000-0000-4000-8000-000000000001',
  '95300000-0000-4000-8000-000000000001','95500000-0000-4000-8000-000000000001',
  '{"consent":true,"position":"Goalie","email":"legacy@example.test","phone":"+1 403 555 0100","date":"2026-08-31"}'::jsonb,
  'staff',repeat('9',64),repeat('8',64)
);

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','95000000-0000-4000-8000-000000000001',true);

select is((select outcome from public.create_staff_registration(
  '95100000-0000-4000-8000-000000000001','95200000-0000-4000-8000-000000000001',
  '95600000-0000-4000-8000-000000000001','95300000-0000-4000-8000-000000000001',null,
  null,null,null,
  '{"consent":true,"position":"Goalie","email":"legacy@example.test","phone":"+1 403 555 0100","date":"2026-08-31"}'::jsonb,repeat('9',64)
)),'idempotency_conflict','upgraded staff rows without canonical request evidence fail closed on replay');

select is((select outcome from public.create_staff_registration(
  '95100000-0000-4000-8000-000000000001','95200000-0000-4000-8000-000000000001',null,
  '95300000-0000-4000-8000-000000000001',null,'  Ada  ','  Lovelace  ','2014-01-02',
  '{"consent":true,"position":"Goalie","email":"player@example.test","phone":"+1 403 555 0100","date":"2026-08-31","note":"  Ready  "}'::jsonb,repeat('a',64)
)),'created','a valid canonical staff registration is created');

select is((select outcome from public.create_staff_registration(
  '95100000-0000-4000-8000-000000000001','95200000-0000-4000-8000-000000000001',null,
  '95300000-0000-4000-8000-000000000001',null,'Ada','Lovelace','2014-01-02',
  '{"consent":true,"position":"Goalie","email":"player@example.test","phone":"+1 403 555 0100","date":"2026-08-31","note":"Ready"}'::jsonb,repeat('a',64)
)),'replayed','canonical-equivalent content replays byte-stably');

select is((select outcome from public.create_staff_registration(
  '95100000-0000-4000-8000-000000000001','95200000-0000-4000-8000-000000000001',null,
  '95300000-0000-4000-8000-000000000001',null,'Ada','Lovelace','2014-01-02',
  '{"consent":true,"position":"Skater","email":"player@example.test","phone":"+1 403 555 0100","date":"2026-08-31","note":"Ready"}'::jsonb,repeat('a',64)
)),'idempotency_conflict','the same key with changed responses conflicts before mutation');

select is((select outcome from public.create_staff_registration(
  '95100000-0000-4000-8000-000000000001','95200000-0000-4000-8000-000000000001',null,
  '95300000-0000-4000-8000-000000000001',null,'Grace','Hopper','2014-01-02',
  '{"consent":true,"position":"Goalie","email":"player@example.test","phone":"+1 403 555 0100","date":"2026-08-31","note":"Ready"}'::jsonb,repeat('a',64)
)),'idempotency_conflict','the same key with changed identity conflicts before mutation');

select throws_ok($$select * from public.create_staff_registration(
  '95100000-0000-4000-8000-000000000001','95200000-0000-4000-8000-000000000001',null,
  '95300000-0000-4000-8000-000000000001',null,'Invalid','Consent','2014-01-02',
  '{"consent":false,"position":"Goalie","email":"player@example.test","phone":"+1 403 555 0100","date":"2026-08-31"}'::jsonb,repeat('b',64)
)$$,'22023',null,'required consent must be true');
select throws_ok($$select * from public.create_staff_registration(
  '95100000-0000-4000-8000-000000000001','95200000-0000-4000-8000-000000000001',null,
  '95300000-0000-4000-8000-000000000001',null,'Invalid','Select','2014-01-02',
  '{"consent":true,"position":"Forward","email":"player@example.test","phone":"+1 403 555 0100","date":"2026-08-31"}'::jsonb,repeat('c',64)
)$$,'22023',null,'select answers must exactly match immutable options');
select throws_ok($$select * from public.create_staff_registration(
  '95100000-0000-4000-8000-000000000001','95200000-0000-4000-8000-000000000001',null,
  '95300000-0000-4000-8000-000000000001',null,'Invalid','Email','2014-01-02',
  '{"consent":true,"position":"Goalie","email":"raw guardian secret","phone":"+1 403 555 0100","date":"2026-08-31"}'::jsonb,repeat('d',64)
)$$,'22023',null,'email answers use the authoritative registration validator');
select throws_ok($$select * from public.create_staff_registration(
  '95100000-0000-4000-8000-000000000001','95200000-0000-4000-8000-000000000001',null,
  '95300000-0000-4000-8000-000000000001',null,'Invalid','Phone','2014-01-02',
  '{"consent":true,"position":"Goalie","email":"player@example.test","phone":"123","date":"2026-08-31"}'::jsonb,repeat('e',64)
)$$,'22023',null,'phone answers use the authoritative registration validator');
select throws_ok($$select * from public.create_staff_registration(
  '95100000-0000-4000-8000-000000000001','95200000-0000-4000-8000-000000000001',null,
  '95300000-0000-4000-8000-000000000001',null,'Invalid','Date','2014-01-02',
  '{"consent":true,"position":"Goalie","email":"player@example.test","phone":"+1 403 555 0100","date":"2026-02-30"}'::jsonb,repeat('f',64)
)$$,'22023',null,'date answers use the authoritative calendar validator');
select throws_ok($$select * from public.create_staff_registration(
  '95100000-0000-4000-8000-000000000001','95200000-0000-4000-8000-000000000001',null,
  '95300000-0000-4000-8000-000000000001',null,'Invalid','Type','2014-01-02',
  '{"consent":true,"position":"Goalie","email":"player@example.test","phone":"+1 403 555 0100","date":"2026-08-31","note":42}'::jsonb,repeat('1',64)
)$$,'22023',null,'text answers reject invalid JSON types');
select throws_ok($$select * from public.create_staff_registration(
  '95100000-0000-4000-8000-000000000001','95200000-0000-4000-8000-000000000001',null,
  '95300000-0000-4000-8000-000000000001',null,'Invalid','Unknown','2014-01-02',
  '{"consent":true,"position":"Goalie","email":"player@example.test","phone":"+1 403 555 0100","date":"2026-08-31","role":"owner"}'::jsonb,repeat('2',64)
)$$,'22023',null,'unknown response keys fail closed');

reset role;
select throws_ok($$update public.tryout_registrations set staff_request_digest=repeat('7',64)
  where id='95700000-0000-4000-8000-000000000001'$$,'55000',null,'staff request evidence is immutable after upgrade');
select is((select count(*) from public.tryout_registrations where organization_id='95100000-0000-4000-8000-000000000001'),2::bigint,'conflicts and invalid attempts add only the one new registration beside legacy evidence');
select is((select count(*) from public.athletes where organization_id='95100000-0000-4000-8000-000000000001'),2::bigint,'conflicts and invalid attempts add only the one new athlete beside the legacy athlete');
select is((select count(*) from public.audit_logs where organization_id='95100000-0000-4000-8000-000000000001' and action='registration.staff_created'),1::bigint,'conflicts and invalid attempts append no audit evidence');
select ok((select coalesce(to_jsonb(registration)->>'staff_request_digest','')~'^[0-9a-f]{64}$'
  from public.tryout_registrations registration
  where organization_id='95100000-0000-4000-8000-000000000001'
    and submission_key_digest=repeat('a',64)),'created evidence carries one canonical request digest');
select is((select responses from public.tryout_registrations
  where organization_id='95100000-0000-4000-8000-000000000001'
    and submission_key_digest=repeat('a',64)),
  '{"consent":true,"position":"Goalie","email":"player@example.test","phone":"+1 403 555 0100","date":"2026-08-31","note":"Ready"}'::jsonb,
  'stored responses are canonical and exact');
select is((select given_name||'|'||family_name from public.athletes
  where organization_id='95100000-0000-4000-8000-000000000001' and given_name='Ada'),'Ada|Lovelace','stored new-athlete identity is canonical');

select * from finish();
rollback;
