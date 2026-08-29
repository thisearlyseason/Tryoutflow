delete from public.registration_confirmation_tokens where organization_id = 'a1101010-1010-4010-8010-101010101010';
delete from public.registration_duplicate_candidates where organization_id = 'a1101010-1010-4010-8010-101010101010';
delete from public.session_enrollments where organization_id = 'a1101010-1010-4010-8010-101010101010';
delete from public.tryout_registrations where organization_id = 'a1101010-1010-4010-8010-101010101010';
delete from public.athlete_guardians where organization_id = 'a1101010-1010-4010-8010-101010101010';
delete from public.guardians where organization_id = 'a1101010-1010-4010-8010-101010101010';
delete from public.athletes where organization_id = 'a1101010-1010-4010-8010-101010101010';
insert into public.organizations(id, name, slug, timezone)
values ('a1101010-1010-4010-8010-101010101010', 'HTTP Registration Club', 'http-registration-club', 'America/Edmonton') on conflict (id) do nothing;
insert into public.tryouts(id, organization_id, name, slug, sport, timezone, registration_starts_at, registration_ends_at)
values ('b1101010-1010-4010-8010-101010101010', 'a1101010-1010-4010-8010-101010101010', 'HTTP Registration Camp', 'http-registration-camp', 'Hockey', 'America/Edmonton', clock_timestamp() - interval '1 hour', clock_timestamp() + interval '1 day') on conflict (id) do nothing;
insert into public.tryout_divisions(id, organization_id, tryout_id, name, sort_order)
select 'c1101010-1010-4010-8010-101010101010', 'a1101010-1010-4010-8010-101010101010', 'b1101010-1010-4010-8010-101010101010', 'U13', 0
where not exists (select 1 from public.tryout_divisions where id = 'c1101010-1010-4010-8010-101010101010');
insert into public.tryout_sessions(id, organization_id, tryout_id, division_id, name, starts_at, ends_at)
select 'd1101010-1010-4010-8010-101010101010', 'a1101010-1010-4010-8010-101010101010', 'b1101010-1010-4010-8010-101010101010', 'c1101010-1010-4010-8010-101010101010', 'Skills', clock_timestamp() + interval '2 days', clock_timestamp() + interval '2 days 1 hour'
where not exists (select 1 from public.tryout_sessions where id = 'd1101010-1010-4010-8010-101010101010');
insert into public.tryout_positions(id,organization_id,tryout_id,name,sort_order)
select 'c2101010-1010-4010-8010-101010101010','a1101010-1010-4010-8010-101010101010','b1101010-1010-4010-8010-101010101010','Goalie',0
where not exists(select 1 from public.tryout_positions where id='c2101010-1010-4010-8010-101010101010');
insert into public.tryout_positions(id,organization_id,tryout_id,name,sort_order)
select 'c3101010-1010-4010-8010-101010101010','a1101010-1010-4010-8010-101010101010','b1101010-1010-4010-8010-101010101010','Skater',1
where not exists(select 1 from public.tryout_positions where id='c3101010-1010-4010-8010-101010101010');
insert into public.registration_forms(id, organization_id, tryout_id, name)
select 'e1101010-1010-4010-8010-101010101010', 'a1101010-1010-4010-8010-101010101010', 'b1101010-1010-4010-8010-101010101010', 'HTTP public form'
where not exists (select 1 from public.registration_forms where id = 'e1101010-1010-4010-8010-101010101010');
insert into public.registration_form_versions(id, organization_id, tryout_id, registration_form_id, version_number, schema, status, published_at)
select
  'f1101010-1010-4010-8010-101010101010',
  'a1101010-1010-4010-8010-101010101010',
  'b1101010-1010-4010-8010-101010101010',
  'e1101010-1010-4010-8010-101010101010',
  1,
  '{"fields":[{"key":"email","label":"Player email","kind":"email","required":true,"sortOrder":0},{"key":"phone","label":"Player phone","kind":"phone","required":true,"sortOrder":1},{"key":"date","label":"Medical date","kind":"date","required":true,"sortOrder":2},{"key":"position","label":"Position","kind":"select","required":true,"sortOrder":3,"options":["Goalie","Skater"]},{"key":"checked","label":"Checked","kind":"checkbox","required":false,"sortOrder":4},{"key":"consent","label":"Consent","kind":"consent","required":true,"sortOrder":5}]}',
  'published',
  clock_timestamp()
where not exists (select 1 from public.registration_form_versions where id = 'f1101010-1010-4010-8010-101010101010');
insert into public.tryout_registration_form_selections(organization_id, tryout_id, registration_form_version_id)
select 'a1101010-1010-4010-8010-101010101010', 'b1101010-1010-4010-8010-101010101010', 'f1101010-1010-4010-8010-101010101010'
where not exists (select 1 from public.tryout_registration_form_selections where organization_id = 'a1101010-1010-4010-8010-101010101010' and tryout_id = 'b1101010-1010-4010-8010-101010101010');
update public.tryouts set status = 'published', published_at = clock_timestamp() where id = 'b1101010-1010-4010-8010-101010101010' and status = 'draft';
