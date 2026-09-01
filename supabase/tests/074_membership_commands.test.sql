begin;

set local search_path=extensions,public;
select plan(22);

select has_column('public','organization_members','version','membership commands use optimistic concurrency');
select has_table('private','membership_command_receipts','membership idempotency receipts are durable and private');
select table_privs_are('private','membership_command_receipts','authenticated',array[]::text[],'clients cannot inspect or forge membership receipts');

insert into auth.users(id,email,email_confirmed_at) values
  ('93000000-0000-4000-8000-000000000001','owner-a@example.test',clock_timestamp()),
  ('93000000-0000-4000-8000-000000000002','owner-b@example.test',clock_timestamp()),
  ('93000000-0000-4000-8000-000000000003','admin@example.test',clock_timestamp()),
  ('93000000-0000-4000-8000-000000000004','member@example.test',clock_timestamp()),
  ('93000000-0000-4000-8000-000000000005','invitee@example.test',null),
  ('93000000-0000-4000-8000-000000000006','outsider@example.test',clock_timestamp());
insert into public.organizations(id,name,slug) values
  ('93100000-0000-4000-8000-000000000001','Membership A','membership-a'),
  ('93100000-0000-4000-8000-000000000002','Membership B','membership-b');
insert into public.organization_members(id,organization_id,user_id,role,status) values
  ('93200000-0000-4000-8000-000000000001','93100000-0000-4000-8000-000000000001','93000000-0000-4000-8000-000000000001','owner','active'),
  ('93200000-0000-4000-8000-000000000002','93100000-0000-4000-8000-000000000001','93000000-0000-4000-8000-000000000002','owner','active'),
  ('93200000-0000-4000-8000-000000000003','93100000-0000-4000-8000-000000000001','93000000-0000-4000-8000-000000000003','administrator','active'),
  ('93200000-0000-4000-8000-000000000004','93100000-0000-4000-8000-000000000001','93000000-0000-4000-8000-000000000004','member','active'),
  ('93200000-0000-4000-8000-000000000006','93100000-0000-4000-8000-000000000002','93000000-0000-4000-8000-000000000006','owner','active');

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','93000000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claim','{"sub":"93000000-0000-4000-8000-000000000001","email":"owner-a@example.test","role":"authenticated"}',true);

select is((select outcome from public.create_organization_invitation(
  '93100000-0000-4000-8000-000000000001','invitee@example.test','member',repeat('a',64),clock_timestamp()+interval '1 day','93300000-0000-4000-8000-000000000001')),'created','owner creates a bound invitation through the RPC');
select throws_ok($$select * from public.organization_invitations$$,'42501',null,'invitation contents have no direct client path');

select set_config('request.jwt.claim.sub','93000000-0000-4000-8000-000000000005',true);
select set_config('request.jwt.claim','{"sub":"93000000-0000-4000-8000-000000000005","email":"invitee@example.test","role":"authenticated"}',true);
select is((select outcome from public.accept_organization_invitation(repeat('a',64))),'unverified','unverified email cannot accept an invitation');

reset role;
update auth.users set email_confirmed_at=clock_timestamp() where id='93000000-0000-4000-8000-000000000005';
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','93000000-0000-4000-8000-000000000005',true);
select set_config('request.jwt.claim','{"sub":"93000000-0000-4000-8000-000000000005","email":"invitee@example.test","role":"authenticated"}',true);
select is((select outcome from public.accept_organization_invitation(repeat('a',64))),'accepted','verified bound email accepts exactly once');

select set_config('request.jwt.claim.sub','93000000-0000-4000-8000-000000000003',true);
select set_config('request.jwt.claim','{"sub":"93000000-0000-4000-8000-000000000003","email":"admin@example.test","role":"authenticated"}',true);
select is((select outcome from public.change_organization_member(
  '93100000-0000-4000-8000-000000000001','93200000-0000-4000-8000-000000000002','member','active',0,'93400000-0000-4000-8000-000000000001')),'forbidden','administrator cannot demote a peer owner');
select is((select outcome from public.change_organization_member(
  '93100000-0000-4000-8000-000000000001','93200000-0000-4000-8000-000000000003','owner','active',0,'93400000-0000-4000-8000-000000000002')),'forbidden','administrator cannot self-escalate');
select is((select outcome from public.change_organization_member(
  '93100000-0000-4000-8000-000000000001','93200000-0000-4000-8000-000000000004','member','disabled',0,'93400000-0000-4000-8000-000000000003')),'updated','administrator may offboard an ordinary member');
select is((select outcome from public.change_organization_member(
  '93100000-0000-4000-8000-000000000001','93200000-0000-4000-8000-000000000004','member','disabled',0,'93400000-0000-4000-8000-000000000003')),'updated','identical membership command replays idempotently');
select is((select count(*) from public.audit_logs where action='organization.member.status_changed' and entity_id='93200000-0000-4000-8000-000000000004'),1::bigint,'offboarding appends exactly one immutable audit event');

select set_config('request.jwt.claim.sub','93000000-0000-4000-8000-000000000001',true);
select is((select outcome from public.change_organization_member(
  '93100000-0000-4000-8000-000000000001','93200000-0000-4000-8000-000000000004','owner','disabled',1,'93400000-0000-4000-8000-000000000006')),'invalid','owner role can only be assigned through atomic ownership transfer');
select is((select outcome from public.transfer_organization_ownership(
  '93100000-0000-4000-8000-000000000001','93200000-0000-4000-8000-000000000003',0,0,'93400000-0000-4000-8000-000000000004')),'transferred','owner can atomically transfer ownership to an active member');
select is((select count(*) from public.audit_logs where action='organization.ownership.transferred'),1::bigint,'ownership transfer appends one audit event');
select is((select outcome from public.transfer_organization_ownership(
  '93100000-0000-4000-8000-000000000001','93200000-0000-4000-8000-000000000003',0,0,'93400000-0000-4000-8000-000000000004')),'transferred','ownership transfer replay is idempotent');

select is((select outcome from public.change_organization_member(
  '93100000-0000-4000-8000-000000000002','93200000-0000-4000-8000-000000000006','member','disabled',0,'93400000-0000-4000-8000-000000000005')),'not_found','cross-tenant target is non-oracular');

reset role;
select is((select role from public.organization_members where id='93200000-0000-4000-8000-000000000001'),'administrator','former owner is demoted atomically');
select is((select role from public.organization_members where id='93200000-0000-4000-8000-000000000003'),'owner','target member becomes owner atomically');
select is((select version from public.organization_members where id='93200000-0000-4000-8000-000000000003'),1::bigint,'membership version advances exactly once');
select is((select count(*) from public.audit_logs where action in('organization.member.role_changed','organization.member.status_changed','organization.ownership.transferred')),2::bigint,'only successful unique commands append role or status audit evidence');
select throws_ok($$truncate table private.membership_command_receipts$$,'55000',null,'membership command receipts cannot be truncated even by the owner');

select * from finish();
rollback;
