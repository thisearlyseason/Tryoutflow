begin;
select plan(17);

select has_function(
  'public',
  'create_tryout_draft',
  array['uuid', 'uuid', 'text', 'text', 'text', 'text', 'timestamptz', 'timestamptz'],
  'tryout drafts are created through an atomic database command'
);
select has_function(
  'public',
  'transition_tryout_lifecycle',
  array['uuid', 'uuid', 'integer', 'text'],
  'lifecycle transitions use a compare-and-swap database command'
);

insert into auth.users (id)
values
  ('21212121-2121-4212-8212-212121212121'),
  ('22222222-2222-4222-8222-222222222222'),
  ('23232323-2323-4232-8232-232323232323'),
  ('24242424-2424-4242-8242-242424242424');

insert into public.organizations (id, name, slug, timezone)
values ('20202020-2020-4202-8202-202020202020', 'Security Club', 'security-club', 'America/Edmonton');

insert into public.organization_members (organization_id, user_id, role)
values
  ('20202020-2020-4202-8202-202020202020', '21212121-2121-4212-8212-212121212121', 'owner'),
  ('20202020-2020-4202-8202-202020202020', '22222222-2222-4222-8222-222222222222', 'member'),
  ('20202020-2020-4202-8202-202020202020', '23232323-2323-4232-8232-232323232323', 'member'),
  ('20202020-2020-4202-8202-202020202020', '24242424-2424-4242-8242-242424242424', 'member');

insert into public.tryouts (id, organization_id, name, slug, sport, timezone)
values ('25252525-2525-4252-8252-252525252525', '20202020-2020-4202-8202-202020202020', 'Security Camp', 'security-camp', 'Hockey', 'America/Edmonton');

insert into public.tryout_divisions (id, organization_id, tryout_id, name, sort_order)
values
  ('26262626-2626-4262-8262-262626262626', '20202020-2020-4202-8202-202020202020', '25252525-2525-4252-8252-252525252525', 'U15', 1),
  ('27272727-2727-4272-8272-272727272727', '20202020-2020-4202-8202-202020202020', '25252525-2525-4252-8252-252525252525', 'U16', 2);

insert into public.tryout_positions (id, organization_id, tryout_id, name, sort_order)
values ('28282828-2828-4282-8282-282828282828', '20202020-2020-4202-8202-202020202020', '25252525-2525-4252-8252-252525252525', 'Forward', 1);

insert into public.tryout_sessions (id, organization_id, tryout_id, division_id, name, starts_at, ends_at)
values
  ('29292929-2929-4292-8292-292929292929', '20202020-2020-4202-8202-202020202020', '25252525-2525-4252-8252-252525252525', '26262626-2626-4262-8262-262626262626', 'U15 Session', '2026-09-10T17:00:00Z', '2026-09-10T18:00:00Z'),
  ('30303030-3030-4303-8303-303030303030', '20202020-2020-4202-8202-202020202020', '25252525-2525-4252-8252-252525252525', '27272727-2727-4272-8272-272727272727', 'U16 Session', '2026-09-10T19:00:00Z', '2026-09-10T20:00:00Z');

insert into public.session_groups (id, organization_id, tryout_id, session_id, name, sort_order)
values
  ('31313131-3131-4313-8313-313131313131', '20202020-2020-4202-8202-202020202020', '25252525-2525-4252-8252-252525252525', '29292929-2929-4292-8292-292929292929', 'U15 Blue', 1),
  ('32323232-3232-4323-8323-323232323232', '20202020-2020-4202-8202-202020202020', '25252525-2525-4252-8252-252525252525', '30303030-3030-4303-8303-303030303030', 'U16 Red', 1);

insert into public.tryout_staff_assignments (organization_id, user_id, role, scope_kind, tryout_id, division_id, granted_by_user_id)
values ('20202020-2020-4202-8202-202020202020', '22222222-2222-4222-8222-222222222222', 'director', 'division', '25252525-2525-4252-8252-252525252525', '26262626-2626-4262-8262-262626262626', '21212121-2121-4212-8212-212121212121');

insert into public.tryout_staff_assignments (organization_id, user_id, role, scope_kind, tryout_id, granted_by_user_id)
values
  ('20202020-2020-4202-8202-202020202020', '23232323-2323-4232-8232-232323232323', 'director', 'tryout', '25252525-2525-4252-8252-252525252525', '21212121-2121-4212-8212-212121212121'),
  ('20202020-2020-4202-8202-202020202020', '24242424-2424-4242-8242-242424242424', 'reviewer', 'tryout', '25252525-2525-4252-8252-252525252525', '21212121-2121-4212-8212-212121212121');

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
select throws_ok(
  $$update public.tryouts set name = 'forged root change' where id = '25252525-2525-4252-8252-252525252525'$$,
  '42501', null,
  'division-scoped directors have no direct tryout-root mutation privilege'
);
select throws_ok(
  $$update public.tryout_positions set name = 'forged global position' where id = '28282828-2828-4282-8282-282828282828'$$,
  '42501', null,
  'division-scoped directors have no direct global-position mutation privilege'
);
select throws_ok(
  $$update public.tryout_divisions set name = 'U15 Updated' where id = '26262626-2626-4262-8262-262626262626'$$,
  '42501', null,
  'division changes use guarded configuration commands instead of direct table DML'
);

reset role;
select is((select name from public.tryouts where id = '25252525-2525-4252-8252-252525252525'), 'Security Camp', 'a division-scoped director cannot change the tryout root');
select is((select name from public.tryout_positions where id = '28282828-2828-4282-8282-282828282828'), 'Forward', 'a division-scoped director cannot change global positions');
select throws_ok(
  $$update public.tryout_sessions set division_id = '27272727-2727-4272-8272-272727272727', sort_order = 1 where id = '29292929-2929-4292-8292-292929292929'$$,
  '23514', null,
  'a session cannot be structurally reparented across divisions'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '23232323-2323-4232-8232-232323232323', true);
select throws_ok(
  $$update public.tryouts set status = 'published', published_at = clock_timestamp() where id = '25252525-2525-4252-8252-252525252525'$$,
  '42501', null,
  'direct table updates cannot publish a tryout outside the lifecycle RPC'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '24242424-2424-4242-8242-242424242424', true);
select is((select count(*) from public.tryout_sessions), 0::bigint, 'reviewers cannot read draft configuration');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '21212121-2121-4212-8212-212121212121', true);
select is(
  (select status from public.create_tryout_draft('20202020-2020-4202-8202-202020202020', null::uuid, 'Atomic Camp', 'atomic-camp', 'Hockey', 'America/Edmonton', null::timestamptz, null::timestamptz)),
  'draft',
  'the create RPC atomically persists a draft root record'
);
select is((select outcome from public.transition_tryout_lifecycle('20202020-2020-4202-8202-202020202020', '25252525-2525-4252-8252-252525252525', 0, 'publish')), 'updated', 'the lifecycle RPC atomically publishes the expected version');
select is((select outcome from public.transition_tryout_lifecycle('20202020-2020-4202-8202-202020202020', '25252525-2525-4252-8252-252525252525', 0, 'publish')), 'conflict', 'a stale lifecycle version cannot overwrite the first publication');
reset role;

select throws_ok(
  $$update public.tryouts set published_at = published_at + interval '1 hour' where id = '25252525-2525-4252-8252-252525252525'$$,
  '23514', null,
  'published timestamp is immutable once set'
);
select throws_ok(
  $$update public.tryouts set name = 'forged published rewrite' where id = '25252525-2525-4252-8252-252525252525'$$,
  '23514', null,
  'published configuration cannot be arbitrarily rewritten'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '21212121-2121-4212-8212-212121212121', true);
select is((select outcome from public.transition_tryout_lifecycle('20202020-2020-4202-8202-202020202020', '25252525-2525-4252-8252-252525252525', 1, 'finalize')), 'updated', 'the lifecycle RPC finalizes only the resulting published version');
reset role;

select throws_ok(
  $$update public.tryout_divisions set name = 'forged finalized change' where id = '26262626-2626-4262-8262-262626262626'$$,
  '23514', null,
  'finalized tryout configuration is immutable'
);

select * from finish();
rollback;
