begin;
select plan(19);

select has_table('public', 'registration_form_versions', 'registration form versions are persisted');
select has_table('public', 'rubrics', 'rubric identities are persisted');
select has_table('public', 'rubric_versions', 'rubric versions are persisted');
select has_table('public', 'rubric_categories', 'ordered rubric categories are persisted');
select has_function('public', 'publish_rubric_version', array['uuid', 'uuid', 'integer'], 'rubric publication is atomic');
select has_function('public', 'create_rubric_revision', array['uuid', 'uuid', 'uuid'], 'revisions are created as new versions');

insert into auth.users (id) values
  ('70707070-7070-4070-8070-707070707070'),
  ('71717171-7171-4171-8171-717171717171');

insert into public.organizations (id, name, slug, timezone)
values ('72727272-7272-4272-8272-727272727272', 'Rubric Club', 'rubric-club', 'America/Edmonton');

insert into public.organization_members (organization_id, user_id, role)
values
  ('72727272-7272-4272-8272-727272727272', '70707070-7070-4070-8070-707070707070', 'owner'),
  ('72727272-7272-4272-8272-727272727272', '71717171-7171-4171-8171-717171717171', 'member');

insert into public.tryouts (id, organization_id, name, slug, sport, timezone)
values ('73737373-7373-4373-8373-737373737373', '72727272-7272-4272-8272-727272727272', 'Rubric Camp', 'rubric-camp', 'Hockey', 'America/Edmonton');

insert into public.tryout_divisions (id, organization_id, tryout_id, name, sort_order)
values ('74747474-7474-4474-8474-747474747474', '72727272-7272-4272-8272-727272727272', '73737373-7373-4373-8373-737373737373', 'U15', 0);

insert into public.tryout_sessions (id, organization_id, tryout_id, division_id, name, starts_at, ends_at)
values ('75757575-7575-4575-8575-757575757575', '72727272-7272-4272-8272-727272727272', '73737373-7373-4373-8373-737373737373', '74747474-7474-4474-8474-747474747474', 'U15 Session', '2026-09-10T17:00:00Z', '2026-09-10T18:00:00Z');

insert into public.registration_forms (id, organization_id, tryout_id, name)
values ('76767676-7676-4676-8676-767676767676', '72727272-7272-4272-8272-727272727272', '73737373-7373-4373-8373-737373737373', 'Default registration');

insert into public.registration_form_versions (id, organization_id, tryout_id, registration_form_id, version_number, schema)
values ('77777777-7777-4777-8777-777777777777', '72727272-7272-4272-8272-727272727272', '73737373-7373-4373-8373-737373737373', '76767676-7676-4676-8676-767676767676', 1, '{"fields":[{"key":"guardian_contact_email","label":"Guardian email","kind":"email","required":true,"sortOrder":0}]}');

insert into public.registration_forms (id, organization_id, tryout_id, name)
values ('78787878-7878-4787-8787-787878787878', '72727272-7272-4272-8272-727272727272', '73737373-7373-4373-8373-737373737373', 'Schema validation');
select throws_ok(
  $$insert into public.registration_form_versions (organization_id, tryout_id, registration_form_id, version_number, schema) values ('72727272-7272-4272-8272-727272727272', '73737373-7373-4373-8373-737373737373', '78787878-7878-4787-8787-787878787878', 1, '{"fields":[{"key":"position","label":"Position","kind":"select","required":false,"sortOrder":0,"options":[1]}]}')$$,
  '23514', null, 'registration schemas reject non-string select options'
);

insert into public.rubrics (id, organization_id, tryout_id, name)
values ('88888888-8888-4888-8888-888888888888', '72727272-7272-4272-8272-727272727272', '73737373-7373-4373-8373-737373737373', 'Skating');

insert into public.rubric_versions (id, organization_id, tryout_id, rubric_id, version_number)
values ('89898989-8989-4989-8989-898989898989', '72727272-7272-4272-8272-727272727272', '73737373-7373-4373-8373-737373737373', '88888888-8888-4888-8888-888888888888', 1);

insert into public.rubric_categories (id, organization_id, tryout_id, rubric_version_id, name, sort_order, weight, scale_min, scale_max)
values
  ('80808080-8080-4080-8080-808080808080', '72727272-7272-4272-8272-727272727272', '73737373-7373-4373-8373-737373737373', '89898989-8989-4989-8989-898989898989', 'Speed', 0, 30.00, 1, 5),
  ('81818181-8181-4181-8181-818181818181', '72727272-7272-4272-8272-727272727272', '73737373-7373-4373-8373-737373737373', '89898989-8989-4989-8989-898989898989', 'Edges', 1, 70.00, 1, 10);

select throws_ok(
  $$insert into public.rubric_categories (organization_id, tryout_id, rubric_version_id, name, sort_order, weight, scale_min, scale_max) values ('72727272-7272-4272-8272-727272727272', '73737373-7373-4373-8373-737373737373', '89898989-8989-4989-8989-898989898989', 'Unsupported', 2, 1.00, 1, 7)$$,
  '23514', null, 'only one-to-five and one-to-ten integer scales are permitted'
);

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '70707070-7070-4070-8070-707070707070', true);
select is((select outcome from public.publish_registration_form_version('72727272-7272-4272-8272-727272727272', '77777777-7777-4777-8777-777777777777', 1)), 'published', 'form publication is an authorized atomic command');
select is((select outcome from public.publish_rubric_version('72727272-7272-4272-8272-727272727272', '88888888-8888-4888-8888-888888888888', 1)), 'published', 'exact decimal category weights publish atomically');
select is((select outcome from public.publish_rubric_version('72727272-7272-4272-8272-727272727272', '88888888-8888-4888-8888-888888888888', 1)), 'conflict', 'stale publication cannot overwrite the first publisher');
reset role;

select throws_ok($$update public.registration_form_versions set schema = '{"fields":[]}' where id = '77777777-7777-4777-8777-777777777777'$$, '23514', null, 'published registration schemas are immutable');
select throws_ok($$update public.rubric_categories set weight = 40.00 where id = '80808080-8080-4080-8080-808080808080'$$, '23514', null, 'published rubric categories are immutable immediately');
select throws_ok($$delete from public.rubric_categories where id = '81818181-8181-4181-8181-818181818181'$$, '23514', null, 'published rubric categories cannot be deleted directly');
select throws_ok(
  $$insert into public.rubric_categories (organization_id, tryout_id, rubric_version_id, name, sort_order, weight, scale_min, scale_max) values ('72727272-7272-4272-8272-727272727272', '73737373-7373-4373-8373-737373737373', '89898989-8989-4989-8989-898989898989', 'Late category', 2, 1.00, 1, 5)$$,
  '23514', null, 'published rubric categories cannot be inserted directly'
);

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '70707070-7070-4070-8070-707070707070', true);
select lives_ok($$select * from public.create_rubric_revision('72727272-7272-4272-8272-727272727272', '88888888-8888-4888-8888-888888888888', '89898989-8989-4989-8989-898989898989')$$, 'a revision snapshots a new draft version');
reset role;
select is((select count(*) from public.rubric_versions where rubric_id = '88888888-8888-4888-8888-888888888888'), 2::bigint, 'a revision creates a new version instead of mutating a published one');
select is((select count(*) from public.rubric_categories where rubric_version_id <> '89898989-8989-4989-8989-898989898989'), 2::bigint, 'revision categories are copied in deterministic order');

select throws_ok(
  $$insert into public.session_rubrics (organization_id, tryout_id, session_id, rubric_version_id) values ('72727272-7272-4272-8272-727272727272', '73737373-7373-4373-8373-737373737373', '75757575-7575-4575-8575-757575757575', '77777777-7777-4777-8777-777777777777')$$,
  '23503', null, 'session assignments cannot bind a version outside the rubric composite identity'
);

select * from finish();
rollback;
