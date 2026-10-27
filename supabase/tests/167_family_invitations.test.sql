begin;
select no_plan();
insert into auth.users(id,email,email_confirmed_at) values
('f1670000-0000-4000-8000-000000000001','family-coach@example.test',now()),
('f1670000-0000-4000-8000-000000000002','family-member@example.test',now()),
('f1670000-0000-4000-8000-000000000003','family-recipient@example.test',now()),
('f1670000-0000-4000-8000-000000000004','family-other@example.test',now()),
('f1670000-0000-4000-8000-000000000005','family-unverified@example.test',null),
('f1670000-0000-4000-8000-000000000006','family-backup-coach@example.test',now());
insert into public.organizations(id,name,slug,timezone) values
('f1670000-0000-4000-8000-000000000010','Family QA','family-invitation-qa','America/Edmonton'),
('f1670000-0000-4000-8000-000000000011','Family Other','family-invitation-other','America/Edmonton');
insert into public.organization_members(organization_id,user_id,role) values
('f1670000-0000-4000-8000-000000000010','f1670000-0000-4000-8000-000000000001','owner'),
('f1670000-0000-4000-8000-000000000010','f1670000-0000-4000-8000-000000000002','member'),
('f1670000-0000-4000-8000-000000000010','f1670000-0000-4000-8000-000000000006','owner'),
('f1670000-0000-4000-8000-000000000011','f1670000-0000-4000-8000-000000000004','owner');
insert into public.athletes(id,organization_id,given_name,family_name,normalized_given_name,normalized_family_name) values
('f1670000-0000-4000-8000-000000000020','f1670000-0000-4000-8000-000000000010','First','Family QA','first','family qa'),
('f1670000-0000-4000-8000-000000000021','f1670000-0000-4000-8000-000000000010','Second','Family QA','second','family qa'),
('f1670000-0000-4000-8000-000000000022','f1670000-0000-4000-8000-000000000011','Other','Family QA','other','family qa');
select ok(not has_table_privilege('authenticated','public.family_invitations','insert'),'clients cannot forge invitations');
select ok(not has_table_privilege('authenticated','public.family_invitations','update'),'clients cannot forge acceptance or revoke arbitrary records');
select ok(not has_column_privilege('authenticated','public.family_invitations','token_digest','select'),'token digests are not exposed to clients');
select ok(not has_function_privilege('anon','public.accept_family_invitation(text)','execute'),'anonymous callers cannot accept');
select ok(not has_function_privilege('service_role','public.accept_family_invitation(text)','execute'),'acceptance requires the real family identity');
set local role authenticated;
select set_config('request.jwt.claim.sub','f1670000-0000-4000-8000-000000000002',true);
select throws_ok($$select public.create_family_invitation('f1670000-0000-4000-8000-000000000010','f1670000-0000-4000-8000-000000000020','family-recipient@example.test','guardian',repeat('a',64))$$,'42501',null,'ordinary staff cannot grant family access');
select set_config('request.jwt.claim.sub','f1670000-0000-4000-8000-000000000004',true);
select throws_ok($$select public.create_family_invitation('f1670000-0000-4000-8000-000000000010','f1670000-0000-4000-8000-000000000020','family-recipient@example.test','guardian',repeat('a',64))$$,'42501',null,'another tenant owner cannot invite');
select set_config('request.jwt.claim.sub','f1670000-0000-4000-8000-000000000001',true);
select throws_ok($$select public.create_family_invitation('f1670000-0000-4000-8000-000000000010','f1670000-0000-4000-8000-000000000022','family-recipient@example.test','guardian',repeat('a',64))$$,'22023',null,'athlete must belong to the selected organization');
select lives_ok($$select public.create_family_invitation('f1670000-0000-4000-8000-000000000010','f1670000-0000-4000-8000-000000000020',' FAMILY-RECIPIENT@example.test ','guardian',repeat('a',64))$$,'organizer creates a scoped invitation before the family has to sign in');
select is((select email from public.family_invitations where athlete_id='f1670000-0000-4000-8000-000000000020'),'family-recipient@example.test','email is normalized');
select set_config('request.jwt.claim.sub','f1670000-0000-4000-8000-000000000004',true);
select is((select count(id) from public.family_invitations),0::bigint,'invitation metadata is tenant scoped');
select throws_ok($$select public.accept_family_invitation(repeat('a',64))$$,'23514',null,'a token alone does not grant access to a different email');
select set_config('request.jwt.claim.sub','f1670000-0000-4000-8000-000000000003',true);
select throws_ok($$insert into public.participant_links(organization_id,athlete_id,user_id,relationship) values('f1670000-0000-4000-8000-000000000010','f1670000-0000-4000-8000-000000000020','f1670000-0000-4000-8000-000000000003','guardian')$$,'42501',null,'family cannot directly forge an athlete link');
select lives_ok($$select public.accept_family_invitation(repeat('a',64))$$,'matching verified family accepts the invitation');
select is((select count(*) from public.participant_links where athlete_id='f1670000-0000-4000-8000-000000000020' and active),1::bigint,'only the invited athlete is connected');
select is((select count(*) from public.organization_members where user_id=auth.uid()),0::bigint,'acceptance never grants staff membership');
select lives_ok($$select public.accept_family_invitation(repeat('a',64))$$,'lost-response replay is idempotent for the same active link');
select is((select count(*) from public.participant_links where user_id=auth.uid()),1::bigint,'replay creates no duplicate link');
select set_config('request.jwt.claim.sub','f1670000-0000-4000-8000-000000000001',true);
select public.create_family_invitation('f1670000-0000-4000-8000-000000000010','f1670000-0000-4000-8000-000000000020','family-recipient@example.test','guardian',repeat('b',64));
update public.participant_links set active=false,version=version+1 where athlete_id='f1670000-0000-4000-8000-000000000020';
select set_config('request.jwt.claim.sub','f1670000-0000-4000-8000-000000000003',true);
select throws_ok($$select public.accept_family_invitation(repeat('a',64))$$,'23514',null,'consumed invitation cannot restore revoked access');
select throws_ok($$select public.accept_family_invitation(repeat('b',64))$$,'23514',null,'pending invitation cannot undo an organizer revocation');
select set_config('request.jwt.claim.sub','f1670000-0000-4000-8000-000000000001',true);
select public.create_family_invitation('f1670000-0000-4000-8000-000000000010','f1670000-0000-4000-8000-000000000021','family-recipient@example.test','guardian',repeat('c',64));
select public.create_family_invitation('f1670000-0000-4000-8000-000000000010','f1670000-0000-4000-8000-000000000021','family-recipient@example.test','guardian',repeat('d',64));
select set_config('request.jwt.claim.sub','f1670000-0000-4000-8000-000000000003',true);
select throws_ok($$select public.accept_family_invitation(repeat('c',64))$$,'23514',null,'reissuing an invitation invalidates the older pending token');
select set_config('request.jwt.claim.sub','f1670000-0000-4000-8000-000000000001',true);
select ok(public.revoke_family_invitation('f1670000-0000-4000-8000-000000000010',(select id from public.family_invitations where athlete_id='f1670000-0000-4000-8000-000000000021' and revoked_at is null)),'organizer can revoke a pending invitation');
select set_config('request.jwt.claim.sub','f1670000-0000-4000-8000-000000000003',true);
select throws_ok($$select public.accept_family_invitation(repeat('d',64))$$,'23514',null,'revoked invitation grants nothing');
reset role;
insert into public.family_invitations(organization_id,athlete_id,email,relationship,token_digest,created_by,expires_at) values
('f1670000-0000-4000-8000-000000000010','f1670000-0000-4000-8000-000000000021','family-recipient@example.test','guardian',repeat('e',64),'f1670000-0000-4000-8000-000000000001',now()-interval '1 second'),
('f1670000-0000-4000-8000-000000000010','f1670000-0000-4000-8000-000000000021','family-unverified@example.test','guardian',repeat('f',64),'f1670000-0000-4000-8000-000000000001',now()+interval '1 day'),
('f1670000-0000-4000-8000-000000000010','f1670000-0000-4000-8000-000000000021','family-recipient@example.test','guardian',repeat('1',64),'f1670000-0000-4000-8000-000000000001',now()+interval '1 day');
set local role authenticated;
select set_config('request.jwt.claim.sub','f1670000-0000-4000-8000-000000000003',true);
select throws_ok($$select public.accept_family_invitation(repeat('e',64))$$,'23514',null,'expired invitation grants nothing');
select set_config('request.jwt.claim.sub','f1670000-0000-4000-8000-000000000005',true);
select throws_ok($$select public.accept_family_invitation(repeat('f',64))$$,'23514',null,'unverified email cannot accept');
reset role;
update public.organization_members set status='disabled' where user_id='f1670000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub','f1670000-0000-4000-8000-000000000003',true);
select throws_ok($$select public.accept_family_invitation(repeat('1',64))$$,'23514',null,'pending invitation fails after the inviter loses authority');
select * from finish();
rollback;
