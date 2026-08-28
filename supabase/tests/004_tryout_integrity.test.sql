begin;
select plan(14);

select has_table('public', 'seasons', 'organization seasons are normalized');
select has_table('public', 'tryouts', 'tryout lifecycle roots are stored');
select has_table('public', 'tryout_divisions', 'tryout divisions are normalized');
select has_table('public', 'tryout_positions', 'tryout positions are normalized');
select has_table('public', 'tryout_sessions', 'tryout sessions are normalized');
select has_table('public', 'session_groups', 'session groups are normalized');

insert into auth.users (id)
values
  ('55555555-5555-4555-8555-555555555555'),
  ('56565656-5656-4565-8565-565656565656'),
  ('57575757-5757-4575-8575-575757575757');

insert into public.organizations (id, name, slug, timezone)
values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'North Club', 'north-club', 'America/Edmonton'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'South Club', 'south-club', 'America/Edmonton');

insert into public.tryouts (id, organization_id, name, slug, sport, timezone)
values
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'North Camp', 'north-camp', 'Hockey', 'America/Edmonton'),
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'South Camp', 'south-camp', 'Hockey', 'America/Edmonton');

insert into public.seasons (id, organization_id, name)
values ('12121212-1212-4121-8121-121212121212', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Fall 2026');

insert into public.tryouts (organization_id, season_id, name, slug, sport, timezone)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '12121212-1212-4121-8121-121212121212', 'Season-linked camp', 'season-linked-camp', 'Hockey', 'America/Edmonton');

delete from public.seasons where id = '12121212-1212-4121-8121-121212121212';
select is(
  (select season_id from public.tryouts where slug = 'season-linked-camp'),
  null::uuid,
  'deleting a season preserves its tryouts without a stale season reference'
);

insert into public.tryout_divisions (id, organization_id, tryout_id, name, sort_order)
values ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'U15', 1);

insert into public.tryout_divisions (id, organization_id, tryout_id, name, sort_order)
values ('fefefefe-fefe-4efe-8efe-fefefefefefe', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'U16', 2);

insert into public.tryout_sessions (id, organization_id, tryout_id, division_id, name, starts_at, ends_at)
values
  ('13131313-1313-4131-8131-131313131313', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'U15 session', '2026-09-10T17:00:00Z', '2026-09-10T18:00:00Z'),
  ('14141414-1414-4141-8141-141414141414', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'fefefefe-fefe-4efe-8efe-fefefefefefe', 'U16 session', '2026-09-10T19:00:00Z', '2026-09-10T20:00:00Z');

insert into public.session_groups (id, organization_id, tryout_id, session_id, name, sort_order)
values
  ('15151515-1515-4151-8151-151515151515', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', '13131313-1313-4131-8131-131313131313', 'U15 Blue', 1),
  ('16161616-1616-4161-8161-161616161616', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', '14141414-1414-4141-8141-141414141414', 'U16 Red', 1);

insert into public.organization_members (organization_id, user_id, role)
values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '55555555-5555-4555-8555-555555555555', 'owner'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '56565656-5656-4565-8565-565656565656', 'member'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '57575757-5757-4575-8575-575757575757', 'member');

insert into public.tryout_staff_assignments (organization_id, user_id, role, scope_kind, tryout_id, granted_by_user_id)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '56565656-5656-4565-8565-565656565656', 'director', 'tryout', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', '55555555-5555-4555-8555-555555555555');

insert into public.tryout_staff_assignments (organization_id, user_id, role, scope_kind, tryout_id, division_id, granted_by_user_id)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '57575757-5757-4575-8575-575757575757', 'director', 'division', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', '55555555-5555-4555-8555-555555555555');

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '56565656-5656-4565-8565-565656565656', true);
select is((select count(*) from public.tryouts), 1::bigint, 'a director reads only their assigned tryout');
select is((select count(*) from public.tryout_divisions), 2::bigint, 'a director reads divisions in their assigned tryout');
select set_config('request.jwt.claim.sub', '57575757-5757-4575-8575-575757575757', true);
select is((select count(*) from public.session_groups), 1::bigint, 'a division-scoped director cannot read groups outside their division');
reset role;

select throws_ok(
  $$insert into public.tryout_sessions (organization_id, tryout_id, division_id, name, starts_at, ends_at) values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'Forged session', '2026-09-10T17:00:00Z', '2026-09-10T18:00:00Z')$$,
  '23503',
  null,
  'a session cannot attach a division from another organization or tryout'
);

select throws_ok(
  $$insert into public.tryout_positions (organization_id, tryout_id, name, sort_order) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'Forward', 1), ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'Defence', 1)$$,
  '23505',
  null,
  'duplicate position ordering is rejected within a tryout'
);

select throws_ok(
  $$insert into public.tryout_sessions (organization_id, tryout_id, division_id, name, starts_at, ends_at) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'Impossible session', '2026-09-10T18:00:00Z', '2026-09-10T17:00:00Z')$$,
  '23514',
  null,
  'a session ending instant must be after its starting instant'
);

select throws_ok(
  $$insert into public.tryout_staff_assignments (organization_id, user_id, role, scope_kind, tryout_id, division_id, granted_by_user_id) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '55555555-5555-4555-8555-555555555555', 'director', 'division', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'ffffffff-ffff-4fff-8fff-ffffffffffff', '55555555-5555-4555-8555-555555555555')$$,
  '23503',
  null,
  'a division-scoped staff assignment must target a division in its tryout and organization'
);

select * from finish();
rollback;
