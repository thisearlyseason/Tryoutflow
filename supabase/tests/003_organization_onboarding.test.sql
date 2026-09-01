begin;
select plan(16);

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

insert into auth.users (id,email,email_confirmed_at)
values ('99999999-9999-4999-8999-999999999999','owner@example.com',clock_timestamp());

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

select ok(
  pg_get_functiondef('public.accept_organization_invitation(text)'::regprocedure) ilike '%for update%',
  'invitation acceptance takes a row lock before changing lifecycle state'
);

reset role;
insert into auth.users (id,email,email_confirmed_at)
values
  ('88888888-8888-4888-8888-888888888888','invitee@example.com',clock_timestamp()),
  ('77777777-7777-4777-8777-777777777777','other@example.com',clock_timestamp()),
  ('66666666-6666-4666-8666-666666666666','expired-invitee@example.com',clock_timestamp());

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '99999999-9999-4999-8999-999999999999', true);
select set_config('request.jwt.claim', '{"sub":"99999999-9999-4999-8999-999999999999","email":"owner@example.com","role":"authenticated"}', true);

reset role;
insert into public.organization_invitations (
  id, organization_id, email, role, token_digest, expires_at, created_by_user_id
)
select
  '10000000-0000-4000-8000-000000000001', id, 'invitee@example.com', 'member', repeat('e',64), now() + interval '1 day', '99999999-9999-4999-8999-999999999999'
from public.organizations where slug = 'badlands-hockey-academy';

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '99999999-9999-4999-8999-999999999999', true);
select set_config('app.invitation_acceptance', 'true', true);
select throws_ok(
  $$update public.organization_invitations set accepted_at = now(), accepted_by_user_id = '88888888-8888-4888-8888-888888888888' where token_digest = repeat('e',64)$$,
  '42501',
  null,
  'owners cannot forge acceptance even after setting the former lifecycle GUC'
);

reset role;
update public.organization_invitations set revoked_at = now() where token_digest = repeat('e',64);
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '99999999-9999-4999-8999-999999999999', true);
select set_config('request.jwt.claim', '{"sub":"99999999-9999-4999-8999-999999999999","email":"owner@example.com","role":"authenticated"}', true);
select set_config('app.invitation_acceptance', 'true', true);
select throws_ok(
  $$update public.organization_invitations set revoked_at = null where token_digest = repeat('e',64)$$,
  '42501',
  null,
  'owners cannot un-revoke an invitation even after setting the former lifecycle GUC'
);

reset role;
insert into public.organization_invitations (
  id, organization_id, email, role, token_digest, expires_at, created_by_user_id
)
select
  '10000000-0000-4000-8000-000000000002', id, 'invitee@example.com', 'member', repeat('a',64), now() + interval '1 day', '99999999-9999-4999-8999-999999999999'
from public.organizations where slug = 'badlands-hockey-academy';

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '88888888-8888-4888-8888-888888888888', true);
select set_config('request.jwt.claim', '{"sub":"88888888-8888-4888-8888-888888888888","email":"invitee@example.com","role":"authenticated"}', true);
select is((select outcome from public.accept_organization_invitation(repeat('a',64))), 'accepted', 'matching email can accept one active invitation');
select is((select count(*) from public.organization_members where user_id = '88888888-8888-4888-8888-888888888888'), 1::bigint, 'successful acceptance creates one membership');
select is((select outcome from public.accept_organization_invitation(repeat('a',64))), 'invalid', 'accepted invitation cannot be replayed');

select set_config('request.jwt.claim.sub', '99999999-9999-4999-8999-999999999999', true);
select set_config('request.jwt.claim', '{"sub":"99999999-9999-4999-8999-999999999999","email":"owner@example.com","role":"authenticated"}', true);
reset role;
insert into public.organization_invitations (
  id, organization_id, email, role, token_digest, expires_at, created_by_user_id
)
select
  '10000000-0000-4000-8000-000000000003', id, 'invitee@example.com', 'member', repeat('b',64), now() + interval '1 day', '99999999-9999-4999-8999-999999999999'
from public.organizations where slug = 'badlands-hockey-academy';

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '77777777-7777-4777-8777-777777777777', true);
select set_config('request.jwt.claim', '{"sub":"77777777-7777-4777-8777-777777777777","email":"other@example.com","role":"authenticated"}', true);
select is((select outcome from public.accept_organization_invitation(repeat('b',64))), 'wrong_email', 'wrong email cannot accept an invitation');

select set_config('request.jwt.claim.sub', '99999999-9999-4999-8999-999999999999', true);
select set_config('request.jwt.claim', '{"sub":"99999999-9999-4999-8999-999999999999","email":"owner@example.com","role":"authenticated"}', true);
reset role;
insert into public.organization_invitations (
  id, organization_id, email, role, token_digest, created_at, expires_at, created_by_user_id
)
select
  '10000000-0000-4000-8000-000000000004', id, 'expired-invitee@example.com', 'member', repeat('c',64), now() - interval '2 minutes', now() - interval '1 minute', '99999999-9999-4999-8999-999999999999'
from public.organizations where slug = 'badlands-hockey-academy';

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '66666666-6666-4666-8666-666666666666', true);
select set_config('request.jwt.claim', '{"sub":"66666666-6666-4666-8666-666666666666","email":"expired-invitee@example.com","role":"authenticated"}', true);
select is((select outcome from public.accept_organization_invitation(repeat('c',64))), 'expired', 'expired invitation cannot be accepted');

select set_config('request.jwt.claim.sub', '99999999-9999-4999-8999-999999999999', true);
select set_config('request.jwt.claim', '{"sub":"99999999-9999-4999-8999-999999999999","email":"owner@example.com","role":"authenticated"}', true);
reset role;
insert into public.organization_invitations (
  id, organization_id, email, role, token_digest, expires_at, created_by_user_id
)
select
  '10000000-0000-4000-8000-000000000005', id, 'invitee@example.com', 'member', repeat('d',64), now() + interval '1 day', '99999999-9999-4999-8999-999999999999'
from public.organizations where slug = 'badlands-hockey-academy';

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '88888888-8888-4888-8888-888888888888', true);
select set_config('request.jwt.claim', '{"sub":"88888888-8888-4888-8888-888888888888","email":"invitee@example.com","role":"authenticated"}', true);
select is((select outcome from public.accept_organization_invitation(repeat('d',64))), 'duplicate_membership', 'existing members cannot consume an additional invitation');

select * from finish();
rollback;
