begin;
select no_plan();

select has_table('public','tryout_numbers','tryout numbers are persisted');
select has_table('public','checkins','check-in receipts are persisted');
select has_table('public','checkin_qr_tokens','QR lookup tokens are separate from confirmation tokens');
select has_function('public','assign_tryout_number',array['uuid','uuid','uuid','uuid','uuid','uuid','text','integer'],'number assignment is transactional');
select has_function('public','check_in_registration',array['uuid','uuid','uuid','uuid','uuid','text','text','integer'],'check-in is transactional and idempotent');
select has_function('public','search_checkin_registrations',array['uuid','uuid','text','integer','text'],'check-in search is controlled');
select function_privs_are('public','can_operate_checkin',array['uuid','uuid','uuid','uuid','uuid'],'anon',array[]::text[],'anonymous cannot invoke authorization internals');
select function_privs_are('public','can_operate_checkin',array['uuid','uuid','uuid','uuid','uuid'],'authenticated',array[]::text[],'authenticated callers cannot invoke authorization internals');
select function_privs_are('public','registration_has_missing_information',array['uuid'],'authenticated',array[]::text[],'validation internals are not public RPCs');
select function_privs_are('public','assign_tryout_number',array['uuid','uuid','uuid','uuid','uuid','uuid','text','integer'],'authenticated',array['EXECUTE'],'authenticated uses the controlled number RPC');
select function_privs_are('public','check_in_registration',array['uuid','uuid','uuid','uuid','uuid','text','text','integer'],'authenticated',array['EXECUTE'],'authenticated uses the controlled check-in RPC');
select table_privs_are('public','tryout_numbers','authenticated',array[]::text[],'number rows have no direct authenticated privileges');
select table_privs_are('public','checkins','authenticated',array[]::text[],'check-in rows have no direct authenticated privileges');
select table_privs_are('public','checkin_qr_tokens','authenticated',array[]::text[],'QR digests have no direct authenticated privileges');
select table_privs_are('public','checkin_search_rate_counters','authenticated',array[]::text[],'rate counters have no direct authenticated privileges');
select is((select relrowsecurity from pg_class where oid='public.tryout_numbers'::regclass),true,'number RLS is enabled');
select is((select relrowsecurity from pg_class where oid='public.checkins'::regclass),true,'check-in RLS is enabled');

insert into auth.users(id) values
 ('12121212-1212-4212-8212-121212121212'),('13131313-1313-4313-8313-131313131313'),
 ('14141414-1414-4414-8414-141414141414'),('15151515-1515-4515-8515-151515151515'),
 ('16161616-1616-4616-8616-161616161616'),('17171717-1717-4717-8717-171717171717');
insert into public.organizations(id,name,slug,timezone) values
 ('20202020-2020-4020-8020-202020202020','Checkin Club','checkin-club','America/Edmonton'),
 ('21212121-2121-4121-8121-212121212121','Other Club','other-checkin-club','America/Edmonton');
insert into public.organization_members(organization_id,user_id,role,status) values
 ('20202020-2020-4020-8020-202020202020','12121212-1212-4212-8212-121212121212','owner','active'),
 ('20202020-2020-4020-8020-202020202020','13131313-1313-4313-8313-131313131313','member','active'),
 ('20202020-2020-4020-8020-202020202020','14141414-1414-4414-8414-141414141414','member','active'),
 ('20202020-2020-4020-8020-202020202020','15151515-1515-4515-8515-151515151515','member','active'),
 ('20202020-2020-4020-8020-202020202020','16161616-1616-4616-8616-161616161616','member','active'),
 ('21212121-2121-4121-8121-212121212121','17171717-1717-4717-8717-171717171717','owner','active');
insert into public.tryouts(id,organization_id,name,slug,sport,timezone,status,published_at) values
 ('22222222-2222-4222-8222-222222222222','20202020-2020-4020-8020-202020202020','Main Checkin','main-checkin','Hockey','America/Edmonton','draft',null),
 ('23232323-2323-4323-8323-232323232323','21212121-2121-4121-8121-212121212121','Other Checkin','other-checkin','Hockey','America/Edmonton','draft',null);
insert into public.tryout_divisions(id,organization_id,tryout_id,name,sort_order) values
 ('24242424-2424-4424-8424-242424242424','20202020-2020-4020-8020-202020202020','22222222-2222-4222-8222-222222222222','U13',0),
 ('25252525-2525-4525-8525-252525252525','20202020-2020-4020-8020-202020202020','22222222-2222-4222-8222-222222222222','U15',1),
 ('26262626-2626-4626-8626-262626262626','21212121-2121-4121-8121-212121212121','23232323-2323-4323-8323-232323232323','Other',0);
insert into public.tryout_sessions(id,organization_id,tryout_id,division_id,name,starts_at,ends_at,sort_order) values
 ('27272727-2727-4727-8727-272727272727','20202020-2020-4020-8020-202020202020','22222222-2222-4222-8222-222222222222','24242424-2424-4424-8424-242424242424','Morning',clock_timestamp()+interval '1 day',clock_timestamp()+interval '1 day 1 hour',0),
 ('28282828-2828-4828-8828-282828282828','20202020-2020-4020-8020-202020202020','22222222-2222-4222-8222-222222222222','24242424-2424-4424-8424-242424242424','Evening',clock_timestamp()+interval '1 day 2 hours',clock_timestamp()+interval '1 day 3 hours',1),
 ('29292929-2929-4929-8929-292929292929','20202020-2020-4020-8020-202020202020','22222222-2222-4222-8222-222222222222','25252525-2525-4525-8525-252525252525','U15',clock_timestamp()+interval '1 day',clock_timestamp()+interval '1 day 1 hour',0);
insert into public.session_groups(id,organization_id,tryout_id,session_id,name,sort_order) values
 ('30303030-3030-4030-8030-303030303030','20202020-2020-4020-8020-202020202020','22222222-2222-4222-8222-222222222222','27272727-2727-4727-8727-272727272727','Blue',0),
 ('31313131-3131-4131-8131-313131313131','20202020-2020-4020-8020-202020202020','22222222-2222-4222-8222-222222222222','27272727-2727-4727-8727-272727272727','Gold',1);
insert into public.registration_forms(id,organization_id,tryout_id,name) values('32323232-3232-4232-8232-323232323232','20202020-2020-4020-8020-202020202020','22222222-2222-4222-8222-222222222222','Checkin form');
insert into public.registration_form_versions(id,organization_id,tryout_id,registration_form_id,version_number,schema,status,published_at) values
 ('33333333-3333-4333-8333-333333333333','20202020-2020-4020-8020-202020202020','22222222-2222-4222-8222-222222222222','32323232-3232-4232-8232-323232323232',1,'{"fields":[{"key":"consent","label":"Consent","kind":"consent","required":true,"sortOrder":0}]}','published',clock_timestamp()),
 ('33333333-3333-4333-8333-333333333334','20202020-2020-4020-8020-202020202020','22222222-2222-4222-8222-222222222222','32323232-3232-4232-8232-323232323232',2,'{"fields":[{"key":"consent","label":"Consent","kind":"consent","required":false,"sortOrder":0}]}','draft',null);
insert into public.athletes(id,organization_id,given_name,family_name,normalized_given_name,normalized_family_name,birth_date) values
 ('34343434-3434-4434-8434-343434343434','20202020-2020-4020-8020-202020202020','Ava','Ready','ava','ready','2013-01-01'),
 ('35353535-3535-4535-8535-353535353535','20202020-2020-4020-8020-202020202020','Mia','Second','mia','second','2013-02-01'),
 ('36363636-3636-4636-8636-363636363636','20202020-2020-4020-8020-202020202020','Wes','Withdrawn','wes','withdrawn','2013-03-01'),
 ('37373737-3737-4737-8737-373737373737','20202020-2020-4020-8020-202020202020','Missy','Missing','missy','missing','2013-04-01');
insert into public.guardians(id,organization_id,name,email,normalized_email,phone) values
 ('38383838-3838-4838-8838-383838383838','20202020-2020-4020-8020-202020202020','Taylor Ready','taylor@example.com','taylor@example.com','+1 403 555 0100');
insert into public.athlete_guardians(organization_id,athlete_id,guardian_id,communication_permitted) values
 ('20202020-2020-4020-8020-202020202020','34343434-3434-4434-8434-343434343434','38383838-3838-4838-8838-383838383838',true);
insert into public.tryout_registrations(id,organization_id,tryout_id,athlete_id,division_id,registration_form_version_id,responses,status,submission_key_digest,submission_digest) values
 ('40404040-4040-4040-8040-404040404040','20202020-2020-4020-8020-202020202020','22222222-2222-4222-8222-222222222222','34343434-3434-4434-8434-343434343434','24242424-2424-4424-8424-242424242424','33333333-3333-4333-8333-333333333333','{"consent":true}','submitted',repeat('a',64),repeat('1',64)),
 ('41414141-4141-4141-8141-414141414141','20202020-2020-4020-8020-202020202020','22222222-2222-4222-8222-222222222222','35353535-3535-4535-8535-353535353535','24242424-2424-4424-8424-242424242424','33333333-3333-4333-8333-333333333333','{"consent":true}','submitted',repeat('b',64),repeat('2',64)),
 ('42424242-4242-4242-8242-424242424242','20202020-2020-4020-8020-202020202020','22222222-2222-4222-8222-222222222222','36363636-3636-4636-8636-363636363636','24242424-2424-4424-8424-242424242424','33333333-3333-4333-8333-333333333333','{"consent":true}','withdrawn',repeat('c',64),repeat('3',64)),
 ('43434343-4343-4343-8343-434343434343','20202020-2020-4020-8020-202020202020','22222222-2222-4222-8222-222222222222','37373737-3737-4737-8737-373737373737','24242424-2424-4424-8424-242424242424','33333333-3333-4333-8333-333333333334','{}','submitted',repeat('d',64),repeat('4',64));
update public.registration_form_versions
set schema='{"fields":[{"key":"consent","label":"Consent","kind":"consent","required":true,"sortOrder":0}]}'
where id='33333333-3333-4333-8333-333333333334';
insert into public.session_enrollments(organization_id,tryout_id,registration_id,session_id) values
 ('20202020-2020-4020-8020-202020202020','22222222-2222-4222-8222-222222222222','40404040-4040-4040-8040-404040404040','27272727-2727-4727-8727-272727272727'),
 ('20202020-2020-4020-8020-202020202020','22222222-2222-4222-8222-222222222222','41414141-4141-4141-8141-414141414141','27272727-2727-4727-8727-272727272727');
insert into public.tryout_staff_assignments(organization_id,user_id,role,scope_kind,tryout_id,division_id,session_id,group_id,granted_by_user_id) values
 ('20202020-2020-4020-8020-202020202020','13131313-1313-4313-8313-131313131313','checkin','tryout','22222222-2222-4222-8222-222222222222',null,null,null,'12121212-1212-4212-8212-121212121212'),
 ('20202020-2020-4020-8020-202020202020','14141414-1414-4414-8414-141414141414','checkin','session','22222222-2222-4222-8222-222222222222',null,'27272727-2727-4727-8727-272727272727',null,'12121212-1212-4212-8212-121212121212'),
 ('20202020-2020-4020-8020-202020202020','15151515-1515-4515-8515-151515151515','checkin','group','22222222-2222-4222-8222-222222222222',null,'27272727-2727-4727-8727-272727272727','30303030-3030-4030-8030-303030303030','12121212-1212-4212-8212-121212121212'),
 ('20202020-2020-4020-8020-202020202020','16161616-1616-4616-8616-161616161616','evaluator','tryout','22222222-2222-4222-8222-222222222222',null,null,null,'12121212-1212-4212-8212-121212121212');

set local session_replication_role=replica;
update public.tryouts set status='published',published_at=clock_timestamp() where id in('22222222-2222-4222-8222-222222222222','23232323-2323-4323-8323-232323232323');
set local session_replication_role=origin;

set local role authenticated;
select set_config('request.jwt.claim.sub','12121212-1212-4212-8212-121212121212',true);
create temporary table checkin_qr_fixture as
select public.issue_checkin_qr_token('20202020-2020-4020-8020-202020202020','22222222-2222-4222-8222-222222222222','40404040-4040-4040-8040-404040404040') as token;
select is((select count(*) from public.audit_logs where action='checkin.qr_issued' and entity_id='40404040-4040-4040-8040-404040404040'),1::bigint,'QR issuance is audited');
select is(public.issue_checkin_qr_token('20202020-2020-4020-8020-202020202020','22222222-2222-4222-8222-222222222222','42424242-4242-4242-8242-424242424242'),null,'QR issuance rejects a withdrawn registration');
select set_config('request.jwt.claim.sub','13131313-1313-4313-8313-131313131313',true);
select is((select outcome from public.assign_tryout_number('20202020-2020-4020-8020-202020202020','22222222-2222-4222-8222-222222222222','40404040-4040-4040-8040-404040404040','24242424-2424-4424-8424-242424242424',null,null,'division',42)),'assigned','tryout check-in staff can assign a division number');
select is((select outcome from public.assign_tryout_number('20202020-2020-4020-8020-202020202020','22222222-2222-4222-8222-222222222222','41414141-4141-4141-8141-414141414141','24242424-2424-4424-8424-242424242424',null,null,'division',42)),'number_conflict','duplicate active number returns a conflict');
select is((select next_available from public.assign_tryout_number('20202020-2020-4020-8020-202020202020','22222222-2222-4222-8222-222222222222','41414141-4141-4141-8141-414141414141','24242424-2424-4424-8424-242424242424',null,null,'division',42)),1,'conflict returns next available');
select is((select outcome from public.assign_tryout_number('20202020-2020-4020-8020-202020202020','22222222-2222-4222-8222-222222222222','42424242-4242-4242-8242-424242424242','24242424-2424-4424-8424-242424242424',null,null,'division',8)),'withdrawn','withdrawn registration is blocked');
select is((select outcome from public.assign_tryout_number('20202020-2020-4020-8020-202020202020','22222222-2222-4222-8222-222222222222','40404040-4040-4040-8040-404040404040','26262626-2626-4626-8626-262626262626',null,null,'division',8)),'invalid_registration','cross-tenant division is rejected');
select is((select count(*) from public.search_checkin_registrations('20202020-2020-4020-8020-202020202020','22222222-2222-4222-8222-222222222222',(select token from checkin_qr_fixture),10,repeat('e',64))),1::bigint,'an active opaque QR token can locate only its registration');
select is((select outcome from public.check_in_registration('20202020-2020-4020-8020-202020202020','22222222-2222-4222-8222-222222222222','40404040-4040-4040-8040-404040404040','27272727-2727-4727-8727-272727272727',null,'checkin-idempotency-key-000001','division',null)),'checked_in','check-in creates one atomic receipt');
select is((select count(*) from public.search_checkin_registrations('20202020-2020-4020-8020-202020202020','22222222-2222-4222-8222-222222222222',(select token from checkin_qr_fixture),10,repeat('e',64))),0::bigint,'a used QR token cannot be replayed for lookup');
select is((select outcome from public.check_in_registration('20202020-2020-4020-8020-202020202020','22222222-2222-4222-8222-222222222222','40404040-4040-4040-8040-404040404040','27272727-2727-4727-8727-272727272727',null,'different-idempotency-key-0002','division',null)),'already_checked_in','repeated check-in returns stable receipt');
select is((select outcome from public.check_in_registration('20202020-2020-4020-8020-202020202020','22222222-2222-4222-8222-222222222222','43434343-4343-4343-8343-434343434343','27272727-2727-4727-8727-272727272727',null,'missing-info-idempotency-0001','division',null)),'missing_information','missing required information blocks check-in');
select is((select count(*) from public.search_checkin_registrations('20202020-2020-4020-8020-202020202020','22222222-2222-4222-8222-222222222222','Ava',10,repeat('e',64))),1::bigint,'bounded name search works');
select is((select count(*) from public.search_checkin_registrations('20202020-2020-4020-8020-202020202020','22222222-2222-4222-8222-222222222222','4035550100',10,repeat('e',64))),1::bigint,'permitted phone search works without returning phone');
select is((select count(*) from public.search_checkin_registrations('20202020-2020-4020-8020-202020202020','22222222-2222-4222-8222-222222222222','Ava',26,repeat('e',64))),0::bigint,'oversized search limit fails closed');

select set_config('request.jwt.claim.sub','14141414-1414-4414-8414-141414141414',true);
select is((select outcome from public.assign_tryout_number('20202020-2020-4020-8020-202020202020','22222222-2222-4222-8222-222222222222','41414141-4141-4141-8141-414141414141','24242424-2424-4424-8424-242424242424','28282828-2828-4828-8828-282828282828',null,'session',7)),'forbidden','session staff cannot operate another session');
create temporary table scoped_checkin_receipt as select * from public.check_in_registration_v2('20202020-2020-4020-8020-202020202020','22222222-2222-4222-8222-222222222222','41414141-4141-4141-8141-414141414141','27272727-2727-4727-8727-272727272727',null,'scoped-session-request-000001','session',7);
select is((select outcome from scoped_checkin_receipt),'checked_in','session-scoped staff can complete production check-in at the assigned placement');
select is((select outcome from public.check_in_registration_v2('20202020-2020-4020-8020-202020202020','22222222-2222-4222-8222-222222222222','41414141-4141-4141-8141-414141414141','27272727-2727-4727-8727-272727272727',null,'scoped-session-request-000001','session',7)),'checked_in','an exact lost-response retry returns the original outcome');
select is((select receipt_id from public.check_in_registration_v2('20202020-2020-4020-8020-202020202020','22222222-2222-4222-8222-222222222222','41414141-4141-4141-8141-414141414141','27272727-2727-4727-8727-272727272727',null,'scoped-session-request-000001','session',7)),(select receipt_id from scoped_checkin_receipt),'an exact retry returns the same receipt id');
select is((select checked_in_at from public.check_in_registration_v2('20202020-2020-4020-8020-202020202020','22222222-2222-4222-8222-222222222222','41414141-4141-4141-8141-414141414141','27272727-2727-4727-8727-272727272727',null,'scoped-session-request-000001','session',7)),(select checked_in_at from scoped_checkin_receipt),'an exact retry returns the same receipt timestamp');
select is((select outcome from public.check_in_registration_v2('20202020-2020-4020-8020-202020202020','22222222-2222-4222-8222-222222222222','41414141-4141-4141-8141-414141414141','27272727-2727-4727-8727-272727272727',null,'scoped-session-request-000001','session',8)),'conflict','retry key reuse with a different payload is rejected');
select is((select count(*) from public.search_checkin_registrations_v2('20202020-2020-4020-8020-202020202020','22222222-2222-4222-8222-222222222222','27272727-2727-4727-8727-272727272727',null,'%%',10,encode(extensions.digest('14141414-1414-4414-8414-141414141414:20202020-2020-4020-8020-202020202020:22222222-2222-4222-8222-222222222222:checkin-search','sha256'),'hex')) where outcome='ok'),0::bigint,'percent metacharacters cannot enumerate registrations');
select is((select count(*) from public.search_checkin_registrations_v2('20202020-2020-4020-8020-202020202020','22222222-2222-4222-8222-222222222222','27272727-2727-4727-8727-272727272727',null,'__',10,encode(extensions.digest('14141414-1414-4414-8414-141414141414:20202020-2020-4020-8020-202020202020:22222222-2222-4222-8222-222222222222:checkin-search','sha256'),'hex')) where outcome='ok'),0::bigint,'underscore metacharacters cannot enumerate registrations');
select is((select outcome from public.search_checkin_registrations_v2('20202020-2020-4020-8020-202020202020','22222222-2222-4222-8222-222222222222','27272727-2727-4727-8727-272727272727',null,'Ava',10,repeat('7',64))),'invalid_request','callers cannot rotate arbitrary rate keys to bypass throttling');
reset role;
update public.checkin_search_rate_counters set attempts=59 where actor_user_id='14141414-1414-4414-8414-141414141414';
set local role authenticated;
select set_config('request.jwt.claim.sub','14141414-1414-4414-8414-141414141414',true);
select is((select distinct outcome from public.search_checkin_registrations_v2('20202020-2020-4020-8020-202020202020','22222222-2222-4222-8222-222222222222','27272727-2727-4727-8727-272727272727',null,'Ava',10,encode(extensions.digest('14141414-1414-4414-8414-141414141414:20202020-2020-4020-8020-202020202020:22222222-2222-4222-8222-222222222222:checkin-search','sha256'),'hex'))),'ok','the 60th search remains allowed');
select is((select outcome from public.search_checkin_registrations_v2('20202020-2020-4020-8020-202020202020','22222222-2222-4222-8222-222222222222','27272727-2727-4727-8727-272727272727',null,'Ava',10,encode(extensions.digest('14141414-1414-4414-8414-141414141414:20202020-2020-4020-8020-202020202020:22222222-2222-4222-8222-222222222222:checkin-search','sha256'),'hex'))),'rate_limited','the 61st search returns an explicit throttling outcome');
select is((select outcome from public.assign_tryout_number('20202020-2020-4020-8020-202020202020','22222222-2222-4222-8222-222222222222','41414141-4141-4141-8141-414141414141','24242424-2424-4424-8424-242424242424','27272727-2727-4727-8727-272727272727',null,'session',8)),'corrected','authorized staff can correct a number after check-in');
select is((select assigned_number from public.assign_tryout_number('20202020-2020-4020-8020-202020202020','22222222-2222-4222-8222-222222222222','41414141-4141-4141-8141-414141414141','24242424-2424-4424-8424-242424242424','27272727-2727-4727-8727-272727272727',null,'session',8)),8,'the corrected number is returned through the controlled boundary');
reset role;
update public.tryout_registrations set responses='{"consent":true}' where id='43434343-4343-4343-8343-434343434343';
set local role authenticated;
select set_config('request.jwt.claim.sub','15151515-1515-4515-8515-151515151515',true);
select is((select count(*) from public.search_checkin_registrations_v2('20202020-2020-4020-8020-202020202020','22222222-2222-4222-8222-222222222222','27272727-2727-4727-8727-272727272727','30303030-3030-4030-8030-303030303030','Missy',10,encode(extensions.digest('15151515-1515-4515-8515-151515151515:20202020-2020-4020-8020-202020202020:22222222-2222-4222-8222-222222222222:checkin-search','sha256'),'hex')) where outcome='ok' and checkin_status='ready'),1::bigint,'group staff can find an eligible unplaced registration in the authorized division');
select is((select outcome from public.check_in_registration_v2('20202020-2020-4020-8020-202020202020','22222222-2222-4222-8222-222222222222','43434343-4343-4343-8343-434343434343','27272727-2727-4727-8727-272727272727','30303030-3030-4030-8030-303030303030','scoped-group-request-0000001','group',7)),'checked_in','group-scoped staff can complete production check-in at the assigned placement');
select is((select outcome from public.assign_tryout_number('20202020-2020-4020-8020-202020202020','22222222-2222-4222-8222-222222222222','41414141-4141-4141-8141-414141414141','24242424-2424-4424-8424-242424242424','27272727-2727-4727-8727-272727272727','31313131-3131-4131-8131-313131313131','group',7)),'forbidden','group staff cannot operate sibling group');
select set_config('request.jwt.claim.sub','16161616-1616-4616-8616-161616161616',true);
select is((select outcome from public.assign_tryout_number('20202020-2020-4020-8020-202020202020','22222222-2222-4222-8222-222222222222','41414141-4141-4141-8141-414141414141','24242424-2424-4424-8424-242424242424',null,null,'division',9)),'forbidden','evaluators cannot assign numbers');
select is((select outcome from public.check_in_registration_v2('20202020-2020-4020-8020-202020202020','22222222-2222-4222-8222-222222222222','40404040-4040-4040-8040-404040404040','27272727-2727-4727-8727-272727272727',null,'oracle-safe-request-0000001','session',null)),'forbidden','unauthorized callers are denied before existing registration or receipt state is disclosed');
reset role;
update public.tryout_registrations set status='withdrawn' where id='41414141-4141-4141-8141-414141414141';
select is((select count(*) from public.tryout_numbers where registration_id='41414141-4141-4141-8141-414141414141' and released_at is null),0::bigint,'withdrawal releases every active number');
update public.organization_members set status='disabled' where organization_id='20202020-2020-4020-8020-202020202020' and user_id='13131313-1313-4313-8313-131313131313';
set local role authenticated;
select set_config('request.jwt.claim.sub','13131313-1313-4313-8313-131313131313',true);
select is((select outcome from public.assign_tryout_number('20202020-2020-4020-8020-202020202020','22222222-2222-4222-8222-222222222222','41414141-4141-4141-8141-414141414141','24242424-2424-4424-8424-242424242424',null,null,'division',9)),'forbidden','offboarding immediately removes check-in authority');
reset role;

select is((select count(*) from public.audit_logs where organization_id='20202020-2020-4020-8020-202020202020' and action='checkin.completed'),3::bigint,'each successful check-in appends exactly one audit event');
select isnt((select token_digest from public.checkin_qr_tokens where registration_id='40404040-4040-4040-8040-404040404040'),(select token from checkin_qr_fixture),'only the QR token digest is stored');
select is((select count(*) from information_schema.columns where table_schema='public' and table_name='checkins' and column_name ~ '(score|rank|rubric|note)'),0::bigint,'check-in storage has no score or ranking fields');
select ok(not pg_get_function_result('public.search_checkin_registrations(uuid,uuid,text,integer,text)'::regprocedure) ~* '(score|rank|rubric|note)','search projection leaks no evaluation fields');

select * from finish();
rollback;
