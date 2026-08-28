begin;

set local search_path = extensions, public;

select plan(33);

select has_table('public'::name, 'organization_members'::name, 'organization memberships exist');
select has_table('public'::name, 'organization_invitations'::name, 'organization invitations exist');
select has_table('public'::name, 'tryout_staff_assignments'::name, 'scoped staff assignments exist');
select has_table('public'::name, 'platform_support_elevations'::name, 'support elevation records exist separately');
select has_column('public'::name, 'tryout_staff_assignments'::name, 'division_id'::name, 'assignments support a tenant-scoped division scope');
select has_index('public'::name, 'organization_members'::name, 'organization_members_organization_id_user_id_key'::name, 'membership uniqueness is indexed');
select has_index('public'::name, 'tryout_staff_assignments'::name, 'tryout_staff_assignments_active_scope_key'::name, 'active assignment scope is indexed');
select ok((select relrowsecurity from pg_class where oid = 'public.organization_members'::regclass), 'memberships have row level security enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.organization_invitations'::regclass), 'invitations have row level security enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.tryout_staff_assignments'::regclass), 'assignments have row level security enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.platform_support_elevations'::regclass), 'support elevations have row level security enabled');
select policies_are('public'::name, 'platform_support_elevations'::name, array[]::name[], 'support elevations have no direct caller policy');

insert into auth.users (id)
values
  ('11111111-1111-4111-8111-111111111111'),
  ('22222222-2222-4222-8222-222222222222'),
  ('33333333-3333-4333-8333-333333333333'),
  ('44444444-4444-4444-8444-444444444444'),
  ('55555555-5555-4555-8555-555555555555'),
  ('66666666-6666-4666-8666-666666666666'),
  ('77777777-7777-4777-8777-777777777777');

insert into public.organizations (id, name, slug)
values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Organization A', 'organization-a'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Organization B', 'organization-b');

insert into public.organization_members (organization_id, user_id, role)
values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', 'owner'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '22222222-2222-4222-8222-222222222222', 'owner'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '33333333-3333-4333-8333-333333333333', 'member'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '44444444-4444-4444-8444-444444444444', 'member'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '55555555-5555-4555-8555-555555555555', 'member'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '66666666-6666-4666-8666-666666666666', 'member'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '77777777-7777-4777-8777-777777777777', 'administrator');

select throws_ok(
  $$update public.organization_members set status = 'disabled' where organization_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and user_id = '11111111-1111-4111-8111-111111111111'$$,
  '23514',
  'organizations must retain an active owner',
  'the last active owner cannot be disabled'
);

select throws_ok(
  $$update public.organization_members set organization_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' where organization_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and user_id = '11111111-1111-4111-8111-111111111111'$$,
  '23514',
  'organizations must retain an active owner',
  'the last active owner cannot be moved to another organization'
);

select throws_ok(
  $$update public.organization_members set user_id = '22222222-2222-4222-8222-222222222222' where organization_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and user_id = '11111111-1111-4111-8111-111111111111'$$,
  '23514',
  'organizations must retain an active owner',
  'the last active owner cannot be reassigned to another user'
);

insert into public.tryout_staff_assignments (organization_id, user_id, role, scope_kind, tryout_id, division_id, session_id, granted_by_user_id)
values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '33333333-3333-4333-8333-333333333333', 'evaluator', 'session', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', null, 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', '11111111-1111-4111-8111-111111111111'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '33333333-3333-4333-8333-333333333333', 'evaluator', 'division', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'ffffffff-ffff-4fff-8fff-ffffffffffff', null, '11111111-1111-4111-8111-111111111111'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '55555555-5555-4555-8555-555555555555', 'checkin', 'tryout', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', null, null, '11111111-1111-4111-8111-111111111111'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '66666666-6666-4666-8666-666666666666', 'reviewer', 'tryout', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', null, null, '11111111-1111-4111-8111-111111111111');

select throws_ok(
  $$insert into public.tryout_staff_assignments (organization_id, user_id, role, scope_kind, tryout_id, granted_by_user_id) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '44444444-4444-4444-8444-444444444444', 'evaluator', 'division', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', '11111111-1111-4111-8111-111111111111')$$,
  '23514',
  null,
  'division assignments require a division scope identifier'
);

set local role authenticated;

select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
select is((select count(*) from public.organizations), 1::bigint, 'owner A sees only organization A');
select ok(public.can_read_tenant_record('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), 'owner A can read own tenant records');
select ok(not public.can_read_tenant_record('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'), 'owner A cannot read organization B records');

select set_config('request.jwt.claim.sub', '77777777-7777-4777-8777-777777777777', true);
select throws_ok(
  $$insert into public.organization_members (organization_id, user_id, role) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '22222222-2222-4222-8222-222222222222', 'owner')$$,
  '42501',
  null,
  'an administrator cannot grant ownership'
);

select set_config('request.jwt.claim.sub', '33333333-3333-4333-8333-333333333333', true);
select is((select count(*) from public.organization_members), 1::bigint, 'a staff member can read only their own membership');
select is((select count(*) from public.tryout_staff_assignments), 2::bigint, 'an evaluator can read only their own assignments');
select ok(
  public.can_access_evaluation(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    null,
    'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    '33333333-3333-4333-8333-333333333333',
    true
  ),
  'assigned evaluator can mutate only their own assigned evaluation'
);
select ok(
  public.can_access_evaluation(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    null,
    'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    '33333333-3333-4333-8333-333333333333',
    false
  ),
  'assigned evaluator can read their own assigned evaluation'
);
select ok(
  public.can_access_evaluation(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    'ffffffff-ffff-4fff-8fff-ffffffffffff',
    'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    '33333333-3333-4333-8333-333333333333',
    false
  ),
  'division assignment remains bounded by its tryout and division'
);
select ok(
  not public.can_access_evaluation(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    null,
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    '33333333-3333-4333-8333-333333333333',
    true
  ),
  'assigned evaluator is denied outside their session scope'
);
select ok(
  not public.can_access_evaluation(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    null,
    'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    '11111111-1111-4111-8111-111111111111',
    true
  ),
  'assigned evaluator cannot mutate another evaluator record'
);
select ok(
  not public.can_access_evaluation(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    null,
    'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    '11111111-1111-4111-8111-111111111111',
    false
  ),
  'assigned evaluator cannot read another evaluator record'
);

select set_config('request.jwt.claim.sub', '44444444-4444-4444-8444-444444444444', true);
select ok(
  not public.can_access_evaluation(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    null,
    'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    '44444444-4444-4444-8444-444444444444',
    false
  ),
  'unassigned evaluator is denied evaluation access'
);

select set_config('request.jwt.claim.sub', '55555555-5555-4555-8555-555555555555', true);
select ok(
  not public.can_access_evaluation(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    null,
    'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    '55555555-5555-4555-8555-555555555555',
    false
  ),
  'check-in staff are denied score access'
);

select set_config('request.jwt.claim.sub', '66666666-6666-4666-8666-666666666666', true);
select ok(
  not public.can_access_evaluation(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    null,
    'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    '66666666-6666-4666-8666-666666666666',
    true
  ),
  'reviewers cannot mutate evaluations'
);

set local role anon;
select set_config('request.jwt.claim.role', 'anon', true);
select set_config('request.jwt.claim.sub', '', true);
select is((select count(*) from public.organizations), 0::bigint, 'anonymous users cannot read tenant records');
select ok(not public.can_read_tenant_record('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'), 'anonymous users cannot read private athlete-bound tenant data');

select * from finish();

rollback;
