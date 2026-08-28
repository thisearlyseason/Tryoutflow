begin;
select plan(7);

select has_column('public', 'organizations', 'terminology', 'organization terminology defaults are persisted');
select col_type_is('public', 'organizations', 'sport_defaults', 'jsonb', 'organization sport defaults are structured');
select has_function('public', 'create_organization_with_owner', array['text', 'text', 'text', 'jsonb', 'jsonb', 'jsonb'], 'atomic organization onboarding function exists');
select ok(
  has_function_privilege('authenticated', 'public.create_organization_with_owner(text, text, text, jsonb, jsonb, jsonb)', 'EXECUTE'),
  'authenticated users can invoke onboarding'
);
select ok(
  not has_function_privilege('anon', 'public.accept_organization_invitation(text)', 'EXECUTE'),
  'anonymous users cannot accept invitations'
);

insert into auth.users (id)
values ('99999999-9999-4999-8999-999999999999');

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '99999999-9999-4999-8999-999999999999', true);

select is(
  (select organization_slug from public.create_organization_with_owner(
    'Badlands Hockey Academy',
    ' Badlands Hockey Academy ',
    'America/Edmonton',
    '{"athlete":"Player"}'::jsonb,
    '[]'::jsonb,
    '[]'::jsonb
  )),
  'badlands-hockey-academy',
  'onboarding normalizes the reserved organization slug'
);
select is(
  (select count(*) from public.organization_members where user_id = '99999999-9999-4999-8999-999999999999'),
  1::bigint,
  'onboarding creates the owner membership in the same database operation'
);

select * from finish();
rollback;
