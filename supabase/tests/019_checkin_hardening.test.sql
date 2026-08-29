begin;
select plan(12);

select has_column('public','checkins','request_payload_digest','receipts bind the retry key to the complete request payload');
select col_not_null('public','checkins','request_payload_digest','every receipt has a payload digest');
select has_function('public','release_tryout_number',array['uuid','uuid','uuid','uuid','uuid','text'],'authorized staff can explicitly release stale or incorrect numbers');
select function_privs_are('public','release_tryout_number',array['uuid','uuid','uuid','uuid','uuid','text'],'authenticated',array['EXECUTE'],'release is exposed only through the authenticated command boundary');
select has_function('public','check_in_registration_v2',array['uuid','uuid','uuid','uuid','uuid','text','text','integer'],'production check-in uses the hardened receipt contract');
select has_function('public','search_checkin_registrations_v2',array['uuid','uuid','uuid','uuid','text','integer','text'],'search is placement-aware and returns an explicit outcome');
select has_fk('public','checkins','receipt number identity is tenant, tryout, and registration safe');
select has_index('public','tryout_numbers','tryout_numbers_one_active_tryout_registration_key','tryout-scoped identity is independent of division');
select has_trigger('public','tryout_registrations','release_registration_numbers','withdrawal and cancellation release active numbers');
select has_trigger('public','session_enrollments','release_stale_placement_numbers','placement moves release session and group scoped numbers');
select is((select count(*) from information_schema.routine_privileges where routine_schema='public' and routine_name in ('checkin_assign_number_internal','registration_has_missing_information') and grantee in ('PUBLIC','anon','authenticated')),0::bigint,'internal authorization helpers are not callable RPCs');
select ok(exists(select 1 from pg_constraint where conrelid='public.checkins'::regclass and contype='f' and pg_get_constraintdef(oid) like '%organization_id, tryout_id, registration_id, tryout_number_id%'),'receipt number FK includes tenant, tryout, and registration');

select * from finish();
rollback;
