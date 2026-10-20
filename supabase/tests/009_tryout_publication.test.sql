begin;
select plan(18);

select has_function('public', 'publish_tryout', array['uuid', 'uuid', 'integer'], 'publication is one database transaction');

insert into auth.users (id) values ('10101010-1010-4010-8010-101010101010');
insert into public.organizations (id, name, slug, timezone)
values ('20202020-2020-4020-8020-202020202020', 'Publish Club', 'publish-club', 'America/Edmonton');
insert into public.organization_members (organization_id, user_id, role)
values ('20202020-2020-4020-8020-202020202020', '10101010-1010-4010-8010-101010101010', 'owner');
insert into auth.users (id) values ('11111111-1111-4111-8111-111111111112');
insert into public.tryouts (id, organization_id, name, slug, sport, timezone, registration_starts_at, registration_ends_at)
values ('30303030-3030-4030-8030-303030303030', '20202020-2020-4020-8020-202020202020', 'Fall ID Camp', 'fall-id-camp', 'Hockey', 'America/Edmonton', clock_timestamp() - interval '1 day', clock_timestamp() + interval '2 days');
insert into public.tryout_divisions (id, organization_id, tryout_id, name, sort_order)
values ('40404040-4040-4040-8040-404040404040', '20202020-2020-4020-8020-202020202020', '30303030-3030-4030-8030-303030303030', 'U15', 0);
insert into public.tryout_sessions (id, organization_id, tryout_id, division_id, name, starts_at, ends_at)
values ('50505050-5050-4050-8050-505050505050', '20202020-2020-4020-8020-202020202020', '30303030-3030-4030-8030-303030303030', '40404040-4040-4040-8040-404040404040', 'Skills', clock_timestamp() + interval '3 days', clock_timestamp() + interval '3 days 2 hours');
insert into public.registration_forms (id, organization_id, tryout_id, name)
values ('60606060-6060-4060-8060-606060606060', '20202020-2020-4020-8020-202020202020', '30303030-3030-4030-8030-303030303030', 'Registration');
insert into public.registration_form_versions (id, organization_id, tryout_id, registration_form_id, version_number, schema)
values ('70707070-7070-4070-8070-707070707070', '20202020-2020-4020-8020-202020202020', '30303030-3030-4030-8030-303030303030', '60606060-6060-4060-8060-606060606060', 1, '{"fields":[]}');
insert into public.registration_forms (id, organization_id, tryout_id, name)
values ('62626262-6262-4262-8262-626262626262', '20202020-2020-4020-8020-202020202020', '30303030-3030-4030-8030-303030303030', 'Alternate registration');
insert into public.registration_form_versions (id, organization_id, tryout_id, registration_form_id, version_number, schema)
values ('72727272-7272-4272-8272-727272727272', '20202020-2020-4020-8020-202020202020', '30303030-3030-4030-8030-303030303030', '62626262-6262-4262-8262-626262626262', 1, '{"fields":[]}');
insert into public.rubrics (id, organization_id, tryout_id, name)
values ('80808080-8080-4080-8080-808080808080', '20202020-2020-4020-8020-202020202020', '30303030-3030-4030-8030-303030303030', 'Skills');
insert into public.rubric_versions (id, organization_id, tryout_id, rubric_id, version_number)
values ('90909090-9090-4090-8090-909090909090', '20202020-2020-4020-8020-202020202020', '30303030-3030-4030-8030-303030303030', '80808080-8080-4080-8080-808080808080', 1);
insert into public.rubric_categories (organization_id, tryout_id, rubric_version_id, name, sort_order, weight, scale_min, scale_max)
values ('20202020-2020-4020-8020-202020202020', '30303030-3030-4030-8030-303030303030', '90909090-9090-4090-8090-909090909090', 'Skating', 0, 100, 1, 5);
set local request.jwt.claim.sub = '11111111-1111-4111-8111-111111111112';
select throws_ok(
  $$select * from public.publish_tryout('20202020-2020-4020-8020-202020202020', '30303030-3030-4030-8030-303030303030', 0)$$,
  '42501', null, 'an inactive non-member cannot publish');
insert into public.session_rubrics (organization_id, tryout_id, session_id, rubric_version_id)
values ('20202020-2020-4020-8020-202020202020', '30303030-3030-4030-8030-303030303030', '50505050-5050-4050-8050-505050505050', '90909090-9090-4090-8090-909090909090');
set local request.jwt.claim.sub = '10101010-1010-4010-8010-101010101010';
select is((select blocker from public.validate_tryout_for_publish('20202020-2020-4020-8020-202020202020', '30303030-3030-4030-8030-303030303030') limit 1), 'registration_form_missing', 'readiness requires an explicit selected form version');
select is(
  (select outcome from public.select_tryout_registration_form_version('20202020-2020-4020-8020-202020202020', '30303030-3030-4030-8030-303030303030', '70707070-7070-4070-8070-707070707070')),
  'selected', 'an exact registration form version is selected before publication');
select is((select outcome from public.publish_tryout('20202020-2020-4020-8020-202020202020', '30303030-3030-4030-8030-303030303030', 0)), 'published', 'publishes a complete draft with CAS');
select is((select status from public.tryouts where id = '30303030-3030-4030-8030-303030303030'), 'published', 'tryout state is published');
select is((select status from public.registration_form_versions where id = '70707070-7070-4070-8070-707070707070'), 'published', 'required form draft is published in transaction');
select is((select status from public.registration_form_versions where id = '72727272-7272-4272-8272-727272727272'), 'draft', 'unselected form draft remains a draft');
select is((select status from public.rubric_versions where id = '90909090-9090-4090-8090-909090909090'), 'published', 'bound draft rubric is published in the same transaction');
select is((select count(*) from public.tryout_publications where tryout_id = '30303030-3030-4030-8030-303030303030'), 1::bigint, 'publication pins one exact form version');
select is((select registration_form_version_id from public.tryout_publications where tryout_id = '30303030-3030-4030-8030-303030303030'), '70707070-7070-4070-8070-707070707070'::uuid, 'publication pins the selected form version');
select is((select count(*) from public.audit_logs where organization_id = '20202020-2020-4020-8020-202020202020' and action = 'tryout.published' and entity_id = '30303030-3030-4030-8030-303030303030'), 1::bigint, 'publication appends an audit event');
select is((select outcome from public.publish_tryout('20202020-2020-4020-8020-202020202020', '30303030-3030-4030-8030-303030303030', 0)), 'already_published', 'a double-click is idempotent');

insert into public.tryouts (id, organization_id, name, slug, sport, timezone, registration_starts_at, registration_ends_at)
values ('31313131-3131-4131-8131-313131313131', '20202020-2020-4020-8020-202020202020', 'Broken Camp', 'broken-camp', 'Hockey', 'America/Edmonton', clock_timestamp() - interval '1 day', clock_timestamp() + interval '2 days');
select is((select outcome from public.publish_tryout('20202020-2020-4020-8020-202020202020', '31313131-3131-4131-8131-313131313131', 0)), 'division_missing', 'missing division blocks publication');
select is((select status from public.tryouts where id = '31313131-3131-4131-8131-313131313131'), 'draft', 'blocker leaves no partial tryout state');

insert into public.tryout_divisions (id, organization_id, tryout_id, name, sort_order)
values ('41414141-4141-4141-8141-414141414141', '20202020-2020-4020-8020-202020202020', '31313131-3131-4131-8131-313131313131', 'U13', 0);
insert into public.tryout_sessions (id, organization_id, tryout_id, division_id, name, starts_at, ends_at)
values ('51515151-5151-4151-8151-515151515151', '20202020-2020-4020-8020-202020202020', '31313131-3131-4131-8131-313131313131', '41414141-4141-4141-8141-414141414141', 'Skills', clock_timestamp() + interval '3 days', clock_timestamp() + interval '3 days 2 hours');
insert into public.registration_forms (id, organization_id, tryout_id, name)
values ('61616161-6161-4161-8161-616161616161', '20202020-2020-4020-8020-202020202020', '31313131-3131-4131-8131-313131313131', 'Registration');
insert into public.registration_form_versions (id, organization_id, tryout_id, registration_form_id, version_number, schema)
values ('71717171-7171-4171-8171-717171717171', '20202020-2020-4020-8020-202020202020', '31313131-3131-4131-8131-313131313131', '61616161-6161-4161-8161-616161616161', 1, '{"fields":[]}');
select is(
  (select outcome from public.select_tryout_registration_form_version('20202020-2020-4020-8020-202020202020', '31313131-3131-4131-8131-313131313131', '70707070-7070-4070-8070-707070707070')),
  'invalid_version', 'selection denies a form version belonging to another tryout');
select outcome from public.select_tryout_registration_form_version('20202020-2020-4020-8020-202020202020', '31313131-3131-4131-8131-313131313131', '71717171-7171-4171-8171-717171717171');
insert into public.rubrics (id, organization_id, tryout_id, name)
values ('81818181-8181-4181-8181-818181818181', '20202020-2020-4020-8020-202020202020', '31313131-3131-4131-8131-313131313131', 'Skills');
insert into public.rubric_versions (id, organization_id, tryout_id, rubric_id, version_number, status, published_at)
values ('91919191-9191-4191-8191-919191919191', '20202020-2020-4020-8020-202020202020', '31313131-3131-4131-8131-313131313131', '81818181-8181-4181-8181-818181818181', 1, 'published', clock_timestamp());
set local session_replication_role = replica;
insert into public.rubric_categories (organization_id, tryout_id, rubric_version_id, name, sort_order, weight, scale_min, scale_max)
values ('20202020-2020-4020-8020-202020202020', '31313131-3131-4131-8131-313131313131', '91919191-9191-4191-8191-919191919191', 'Skating', 0, 90, 1, 5);
set local session_replication_role = origin;
insert into public.session_rubrics (organization_id, tryout_id, session_id, rubric_version_id)
values ('20202020-2020-4020-8020-202020202020', '31313131-3131-4131-8131-313131313131', '51515151-5151-4151-8151-515151515151', '91919191-9191-4191-8191-919191919191');
select is((select outcome from public.publish_tryout('20202020-2020-4020-8020-202020202020', '31313131-3131-4131-8131-313131313131', 0)), 'rubric_invalid', '90-point rubric blocks publication');
select is((select count(*) from public.audit_logs where entity_id = '31313131-3131-4131-8131-313131313131'), 0::bigint, 'failed validation does not write an audit event');

select * from finish();
rollback;
