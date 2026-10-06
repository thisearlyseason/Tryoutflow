begin;
set local search_path=extensions,public;
select plan(20);

select has_function('public','list_organization_invitations',array['uuid','integer','integer'],'invitation history has a bounded RPC');
insert into auth.users(id,email) values
('a8100000-0000-4000-8000-000000000001','history-owner@example.test'),
('a8100000-0000-4000-8000-000000000002','history-admin@example.test'),
('a8100000-0000-4000-8000-000000000003','history-member@example.test'),
('a8100000-0000-4000-8000-000000000004','history-outsider@example.test');
insert into public.organizations(id,name,slug) values
('a8110000-0000-4000-8000-000000000001','History A','invitation-history-a'),
('a8110000-0000-4000-8000-000000000002','History B','invitation-history-b');
insert into public.organization_members(organization_id,user_id,role,status) values
('a8110000-0000-4000-8000-000000000001','a8100000-0000-4000-8000-000000000001','owner','active'),
('a8110000-0000-4000-8000-000000000001','a8100000-0000-4000-8000-000000000002','administrator','active'),
('a8110000-0000-4000-8000-000000000001','a8100000-0000-4000-8000-000000000003','member','active'),
('a8110000-0000-4000-8000-000000000002','a8100000-0000-4000-8000-000000000004','owner','active');
insert into public.organization_invitations(organization_id,email,role,token_digest,expires_at,created_by_user_id,created_at)
select 'a8110000-0000-4000-8000-000000000001', 'invite-'||n||'@example.test','member',md5(n::text)||md5(n::text),
now()+interval '1 day','a8100000-0000-4000-8000-000000000001',now()-n*interval '1 minute'
from generate_series(1,105) n;
insert into public.organization_invitations(organization_id,email,role,token_digest,expires_at,created_by_user_id)
values('a8110000-0000-4000-8000-000000000002','other-tenant@example.test','member',repeat('f',64),now()+interval '1 day','a8100000-0000-4000-8000-000000000004');

set local role authenticated;
select set_config('request.jwt.claim.sub','a8100000-0000-4000-8000-000000000001',true);
select is((select count(*) from public.list_organization_invitations('a8110000-0000-4000-8000-000000000001')),25::bigint,'owner sees default recent page');
select is((select email from public.list_organization_invitations('a8110000-0000-4000-8000-000000000001',1,0)),'invite-1@example.test','newest invitation comes first');
select is((select email from public.list_organization_invitations('a8110000-0000-4000-8000-000000000001',1,1)),'invite-2@example.test','offset advances the bounded page');
select is((select count(*) from public.list_organization_invitations('a8110000-0000-4000-8000-000000000001',100,0)),100::bigint,'maximum page is supported');
select is((select count(*) from public.list_organization_invitations('a8110000-0000-4000-8000-000000000001',100,100)),5::bigint,'pages stay scoped to the organization');
select is((select array_agg(key order by key) from jsonb_object_keys((select to_jsonb(i) from public.list_organization_invitations('a8110000-0000-4000-8000-000000000001',1,0) i)) key),array['accepted_at','created_at','email','expires_at','id','revoked_at','role']::text[],'only display fields are returned, excluding digests and actor IDs');
select throws_ok($$select * from public.organization_invitations$$,'42501',null,'raw invitations remain inaccessible');
select throws_ok($$select * from public.list_organization_invitations('a8110000-0000-4000-8000-000000000002')$$,'42501',null,'owner cannot read another tenant');
select throws_ok($$select * from public.list_organization_invitations('a8110000-0000-4000-8000-000000000001',101,0)$$,'22023',null,'oversized pages fail closed');
select throws_ok($$select * from public.list_organization_invitations('a8110000-0000-4000-8000-000000000001',0,0)$$,'22023',null,'zero page sizes fail closed');
select throws_ok($$select * from public.list_organization_invitations('a8110000-0000-4000-8000-000000000001',null,0)$$,'22023',null,'null page sizes fail closed');
select throws_ok($$select * from public.list_organization_invitations('a8110000-0000-4000-8000-000000000001',25,-1)$$,'22023',null,'negative offsets fail closed');
select throws_ok($$select * from public.list_organization_invitations('a8110000-0000-4000-8000-000000000001',25,10001)$$,'22023',null,'unbounded offsets fail closed');
select set_config('request.jwt.claim.sub','a8100000-0000-4000-8000-000000000002',true);
select is((select count(*) from public.list_organization_invitations('a8110000-0000-4000-8000-000000000001')),25::bigint,'active administrator can read history');
reset role;
update public.organization_members set status='disabled' where user_id='a8100000-0000-4000-8000-000000000002';
set local role authenticated;
select throws_ok($$select * from public.list_organization_invitations('a8110000-0000-4000-8000-000000000001')$$,'42501',null,'disabled administrator is denied');
select set_config('request.jwt.claim.sub','a8100000-0000-4000-8000-000000000003',true);
select throws_ok($$select * from public.list_organization_invitations('a8110000-0000-4000-8000-000000000001')$$,'42501',null,'ordinary member cannot read invitation addresses');
select set_config('request.jwt.claim.sub','a8100000-0000-4000-8000-000000000004',true);
select throws_ok($$select * from public.list_organization_invitations('a8110000-0000-4000-8000-000000000001')$$,'42501',null,'outsider is denied');
select set_config('request.jwt.claim.sub','',true);
select throws_ok($$select * from public.list_organization_invitations('a8110000-0000-4000-8000-000000000001')$$,'42501',null,'missing user identity is denied');
set local role anon;
select throws_ok($$select * from public.list_organization_invitations('a8110000-0000-4000-8000-000000000001')$$,'42501',null,'anonymous role cannot execute history RPC');
reset role;
select * from finish();
rollback;
