begin;
select no_plan();

select is((select count(*) from pg_class c cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) acl where c.oid='public.audit_logs'::regclass and acl.grantee=0),0::bigint,'PUBLIC has no audit history privileges');
select table_privs_are('public','audit_logs','anon',array[]::text[],'anonymous has no audit history privileges');
select table_privs_are('public','audit_logs','authenticated',array['SELECT'],'authenticated receives only RLS-governed audit reads');
select table_privs_are('public','audit_logs','service_role',array[]::text[],'service role cannot bypass the audit writer boundary');
select is((select count(*) from pg_class c cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) acl where c.oid='public.platform_support_elevations'::regclass and acl.grantee=0),0::bigint,'PUBLIC has no support-elevation history privileges');
select table_privs_are('public','platform_support_elevations','anon',array[]::text[],'anonymous has no support-elevation history privileges');
select table_privs_are('public','platform_support_elevations','authenticated',array[]::text[],'authenticated cannot mutate support-elevation history');
select table_privs_are('public','platform_support_elevations','service_role',array[]::text[],'service role cannot mutate support-elevation history directly');
select is((select count(*) from unnest(array['anon','authenticated','service_role']) role_name cross join unnest(array['audit_logs','platform_support_elevations']) table_name cross join unnest(array['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) privilege_name where has_table_privilege(role_name,format('public.%I',table_name),privilege_name)),0::bigint,'every client role is denied the complete unsafe security-history privilege matrix');
select has_function('public','can_operate_checkin_registration',array['uuid','uuid','uuid','uuid','uuid','uuid'],'registration-scoped authorization has one shared boundary');
select function_privs_are('public','can_operate_checkin_registration',array['uuid','uuid','uuid','uuid','uuid','uuid'],'authenticated',array[]::text[],'registration-scoped authorization is not a caller RPC');
select has_trigger('public','session_enrollments','a_lock_session_enrollment_registration','every enrollment insert, move, and delete locks its parent registration');

insert into auth.users(id) values
  ('90121212-1212-4212-8212-121212121212'),
  ('90131313-1313-4313-8313-131313131313'),
  ('90141414-1414-4414-8414-141414141414');
insert into public.organizations(id,name,slug,timezone)
values('90202020-2020-4020-8020-202020202020','Enrollment Scope Club','enrollment-scope-club','America/Edmonton');
insert into public.organization_members(organization_id,user_id,role,status) values
  ('90202020-2020-4020-8020-202020202020','90121212-1212-4212-8212-121212121212','owner','active'),
  ('90202020-2020-4020-8020-202020202020','90131313-1313-4313-8313-131313131313','member','active'),
  ('90202020-2020-4020-8020-202020202020','90141414-1414-4414-8414-141414141414','member','active');
insert into public.tryouts(id,organization_id,name,slug,sport,timezone)
values('90222222-2222-4222-8222-222222222222','90202020-2020-4020-8020-202020202020','Enrollment Scope','enrollment-scope','Hockey','America/Edmonton');
insert into public.tryout_divisions(id,organization_id,tryout_id,name,sort_order) values
  ('90242424-2424-4424-8424-242424242424','90202020-2020-4020-8020-202020202020','90222222-2222-4222-8222-222222222222','U13',0),
  ('90252525-2525-4525-8525-252525252525','90202020-2020-4020-8020-202020202020','90222222-2222-4222-8222-222222222222','U15',1);
insert into public.tryout_sessions(id,organization_id,tryout_id,division_id,name,starts_at,ends_at,sort_order) values
  ('90272727-2727-4727-8727-272727272727','90202020-2020-4020-8020-202020202020','90222222-2222-4222-8222-222222222222','90242424-2424-4424-8424-242424242424','Session one',clock_timestamp()+interval '1 day',clock_timestamp()+interval '1 day 1 hour',0),
  ('90282828-2828-4828-8828-282828282828','90202020-2020-4020-8020-202020202020','90222222-2222-4222-8222-222222222222','90242424-2424-4424-8424-242424242424','Session two',clock_timestamp()+interval '1 day 2 hours',clock_timestamp()+interval '1 day 3 hours',1),
  ('90292929-2929-4929-8929-292929292929','90202020-2020-4020-8020-202020202020','90222222-2222-4222-8222-222222222222','90252525-2525-4525-8525-252525252525','Other division',clock_timestamp()+interval '1 day',clock_timestamp()+interval '1 day 1 hour',0);
insert into public.session_groups(id,organization_id,tryout_id,session_id,name,sort_order) values
  ('90303030-3030-4030-8030-303030303030','90202020-2020-4020-8020-202020202020','90222222-2222-4222-8222-222222222222','90272727-2727-4727-8727-272727272727','G1',0),
  ('90313131-3131-4131-8131-313131313131','90202020-2020-4020-8020-202020202020','90222222-2222-4222-8222-222222222222','90272727-2727-4727-8727-272727272727','G2',1);
insert into public.registration_forms(id,organization_id,tryout_id,name)
values('90323232-3232-4232-8232-323232323232','90202020-2020-4020-8020-202020202020','90222222-2222-4222-8222-222222222222','Form');
insert into public.registration_form_versions(id,organization_id,tryout_id,registration_form_id,version_number,schema,status,published_at)
values('90333333-3333-4333-8333-333333333333','90202020-2020-4020-8020-202020202020','90222222-2222-4222-8222-222222222222','90323232-3232-4232-8232-323232323232',1,'{"fields":[]}','published',clock_timestamp());
insert into public.athletes(id,organization_id,given_name,family_name,normalized_given_name,normalized_family_name,birth_date) values
  ('90343434-3434-4434-8434-343434343434','90202020-2020-4020-8020-202020202020','G2','Placed','g2','placed','2013-01-01'),
  ('90353535-3535-4535-8535-353535353535','90202020-2020-4020-8020-202020202020','Sibling','Session','sibling','session','2013-01-02'),
  ('90363636-3636-4636-8636-363636363636','90202020-2020-4020-8020-202020202020','Unplaced','Exact','unplaced','exact','2013-01-03'),
  ('90373737-3737-4737-8737-373737373737','90202020-2020-4020-8020-202020202020','Stale','Division','stale','division','2013-01-04'),
  ('90383838-3838-4838-8838-383838383838','90202020-2020-4020-8020-202020202020','Multiple','Sessions','multiple','sessions','2013-01-05');
insert into public.tryout_registrations(id,organization_id,tryout_id,athlete_id,division_id,registration_form_version_id,responses,submission_key_digest,submission_digest) values
  ('90404040-4040-4040-8040-404040404040','90202020-2020-4020-8020-202020202020','90222222-2222-4222-8222-222222222222','90343434-3434-4434-8434-343434343434','90242424-2424-4424-8424-242424242424','90333333-3333-4333-8333-333333333333','{}',repeat('a',64),repeat('1',64)),
  ('90414141-4141-4141-8141-414141414141','90202020-2020-4020-8020-202020202020','90222222-2222-4222-8222-222222222222','90353535-3535-4535-8535-353535353535','90242424-2424-4424-8424-242424242424','90333333-3333-4333-8333-333333333333','{}',repeat('b',64),repeat('2',64)),
  ('90424242-4242-4242-8242-424242424242','90202020-2020-4020-8020-202020202020','90222222-2222-4222-8222-222222222222','90363636-3636-4636-8636-363636363636','90242424-2424-4424-8424-242424242424','90333333-3333-4333-8333-333333333333','{}',repeat('c',64),repeat('3',64)),
  ('90434343-4343-4343-8343-434343434343','90202020-2020-4020-8020-202020202020','90222222-2222-4222-8222-222222222222','90373737-3737-4737-8737-373737373737','90242424-2424-4424-8424-242424242424','90333333-3333-4333-8333-333333333333','{}',repeat('d',64),repeat('4',64)),
  ('90444444-4444-4444-8444-444444444444','90202020-2020-4020-8020-202020202020','90222222-2222-4222-8222-222222222222','90383838-3838-4838-8838-383838383838','90242424-2424-4424-8424-242424242424','90333333-3333-4333-8333-333333333333','{}',repeat('e',64),repeat('5',64));
insert into public.session_enrollments(organization_id,tryout_id,registration_id,session_id,group_id) values
  ('90202020-2020-4020-8020-202020202020','90222222-2222-4222-8222-222222222222','90404040-4040-4040-8040-404040404040','90272727-2727-4727-8727-272727272727','90313131-3131-4131-8131-313131313131'),
  ('90202020-2020-4020-8020-202020202020','90222222-2222-4222-8222-222222222222','90414141-4141-4141-8141-414141414141','90282828-2828-4828-8828-282828282828',null),
  ('90202020-2020-4020-8020-202020202020','90222222-2222-4222-8222-222222222222','90434343-4343-4343-8343-434343434343','90292929-2929-4929-8929-292929292929',null),
  ('90202020-2020-4020-8020-202020202020','90222222-2222-4222-8222-222222222222','90444444-4444-4444-8444-444444444444','90272727-2727-4727-8727-272727272727','90303030-3030-4030-8030-303030303030'),
  ('90202020-2020-4020-8020-202020202020','90222222-2222-4222-8222-222222222222','90444444-4444-4444-8444-444444444444','90282828-2828-4828-8828-282828282828',null);
insert into public.tryout_staff_assignments(organization_id,user_id,role,scope_kind,tryout_id,session_id,group_id,granted_by_user_id) values
  ('90202020-2020-4020-8020-202020202020','90131313-1313-4313-8313-131313131313','checkin','group','90222222-2222-4222-8222-222222222222','90272727-2727-4727-8727-272727272727','90303030-3030-4030-8030-303030303030','90121212-1212-4212-8212-121212121212'),
  ('90202020-2020-4020-8020-202020202020','90141414-1414-4414-8414-141414141414','checkin','session','90222222-2222-4222-8222-222222222222','90272727-2727-4727-8727-272727272727',null,'90121212-1212-4212-8212-121212121212');
set local session_replication_role=replica;
update public.tryouts set status='published',published_at=clock_timestamp() where id='90222222-2222-4222-8222-222222222222';
set local session_replication_role=origin;

set local role authenticated;
select set_config('request.jwt.claim.sub','90121212-1212-4212-8212-121212121212',true);
select is((select outcome from public.assign_tryout_number('90202020-2020-4020-8020-202020202020','90222222-2222-4222-8222-222222222222','90404040-4040-4040-8040-404040404040','90242424-2424-4424-8424-242424242424','90272727-2727-4727-8727-272727272727','90313131-3131-4131-8131-313131313131','group',55)),'assigned','root authority can assign the existing G2 placement');

select set_config('request.jwt.claim.sub','90131313-1313-4313-8313-131313131313',true);
select is((select count(*) from public.search_checkin_registrations_v2('90202020-2020-4020-8020-202020202020','90222222-2222-4222-8222-222222222222','90272727-2727-4727-8727-272727272727','90303030-3030-4030-8030-303030303030','90404040-4040-4040-8040-404040404040',10,encode(extensions.digest('90131313-1313-4313-8313-131313131313:90202020-2020-4020-8020-202020202020:90222222-2222-4222-8222-222222222222:checkin-search','sha256'),'hex')) where outcome='ok'),0::bigint,'G1 search cannot reveal a known G2 registration UUID');
select is((select outcome from public.assign_tryout_number('90202020-2020-4020-8020-202020202020','90222222-2222-4222-8222-222222222222','90404040-4040-4040-8040-404040404040','90242424-2424-4424-8424-242424242424','90272727-2727-4727-8727-272727272727','90303030-3030-4030-8030-303030303030','group',56)),'forbidden','G1 cannot assign or rehome a registration currently in G2');
select is(public.release_tryout_number('90202020-2020-4020-8020-202020202020','90222222-2222-4222-8222-222222222222','90404040-4040-4040-8040-404040404040','90272727-2727-4727-8727-272727272727','90303030-3030-4030-8030-303030303030','offboarding'),'forbidden','G1 cannot release a registration currently in G2');
select is((select outcome from public.check_in_registration_v2('90202020-2020-4020-8020-202020202020','90222222-2222-4222-8222-222222222222','90404040-4040-4040-8040-404040404040','90272727-2727-4727-8727-272727272727','90303030-3030-4030-8030-303030303030','known-g2-request-00000001','group',56)),'forbidden','G1 cannot check in or rehome a registration currently in G2');
select is((select outcome from public.check_in_registration_v2('90202020-2020-4020-8020-202020202020','90222222-2222-4222-8222-222222222222','90424242-4242-4242-8242-424242424242','90272727-2727-4727-8727-272727272727','90303030-3030-4030-8030-303030303030','exact-unplaced-request-0001','group',57)),'checked_in','G1 may place a truly unplaced same-division registration into G1');

select set_config('request.jwt.claim.sub','90141414-1414-4414-8414-141414141414',true);
select is((select outcome from public.assign_tryout_number('90202020-2020-4020-8020-202020202020','90222222-2222-4222-8222-222222222222','90414141-4141-4141-8141-414141414141','90242424-2424-4424-8424-242424242424','90272727-2727-4727-8727-272727272727',null,'session',58)),'forbidden','S1 staff cannot take a registration enrolled only in sibling session S2');
select is((select outcome from public.check_in_registration_v2('90202020-2020-4020-8020-202020202020','90222222-2222-4222-8222-222222222222','90434343-4343-4343-8343-434343434343','90272727-2727-4727-8727-272727272727',null,'stale-enrollment-request-01','session',59)),'forbidden','a stale cross-division enrollment fails closed for scoped staff');
select is((select outcome from public.assign_tryout_number('90202020-2020-4020-8020-202020202020','90222222-2222-4222-8222-222222222222','90444444-4444-4444-8444-444444444444','90242424-2424-4424-8424-242424242424','90272727-2727-4727-8727-272727272727',null,'session',60)),'assigned','multiple valid session enrollments remain operable only at an exact enrolled session');

select * from finish();
rollback;
