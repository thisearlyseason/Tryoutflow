begin;
select plan(61);

select ok(public.is_valid_registration_email('player@example.com'), 'dynamic email validator accepts a bounded address');
select ok(not public.is_valid_registration_email('not-an-email'), 'dynamic email validator rejects malformed input');
select ok(not public.is_valid_registration_email(repeat('a', 245) || '@example.com'), 'dynamic email validator caps addresses at 254 characters');
select ok(public.is_valid_registration_phone('+1 (403) 555-0100'), 'dynamic phone validator accepts permitted punctuation and normalized digits');
select ok(not public.is_valid_registration_phone('+1 403 CALL-NOW'), 'dynamic phone validator rejects letters');
select ok(not public.is_valid_registration_phone('+1 (23) 45'), 'dynamic phone validator rejects too few normalized digits');
select ok(public.is_valid_registration_calendar_date('2024-02-29'), 'calendar validator accepts leap day');
select ok(not public.is_valid_registration_calendar_date('2023-02-29'), 'calendar validator rejects a non-leap day');
select ok(not public.is_valid_registration_calendar_date('2024-2-09'), 'calendar validator requires exact YYYY-MM-DD');

select function_privs_are('public', 'consume_registration_confirmation_token', array['text'], 'anon', array[]::text[], 'anonymous cannot consume confirmation tokens');
select function_privs_are('public', 'consume_registration_confirmation_token', array['text'], 'authenticated', array[]::text[], 'authenticated clients cannot consume confirmation tokens directly');
select function_privs_are('public', 'consume_registration_confirmation_token', array['text'], 'service_role', array['EXECUTE'], 'only the server role can consume confirmation tokens');
select function_privs_are('public', 'reissue_registration_confirmation_token', array['text', 'text'], 'anon', array[]::text[], 'anonymous cannot reissue confirmation tokens');
select function_privs_are('public', 'reissue_registration_confirmation_token', array['text', 'text'], 'authenticated', array[]::text[], 'authenticated clients cannot reissue confirmation tokens directly');
select function_privs_are('public', 'reissue_registration_confirmation_token', array['text', 'text'], 'service_role', array['EXECUTE'], 'only the server role can reissue confirmation tokens');
select function_privs_are('public', 'consume_public_registration_rate_limit', array['text', 'integer'], 'anon', array[]::text[], 'anonymous cannot allocate public rate buckets');
select function_privs_are('public', 'consume_public_registration_rate_limit', array['text', 'integer'], 'authenticated', array[]::text[], 'authenticated clients cannot allocate public rate buckets');
select function_privs_are('public', 'consume_public_registration_rate_limit', array['text', 'integer'], 'service_role', array['EXECUTE'], 'only the server role allocates public rate buckets');

insert into auth.users(id) values
  ('21111111-1111-4111-8111-111111111111'),
  ('22111111-1111-4111-8111-111111111111'),
  ('23111111-1111-4111-8111-111111111111'),
  ('24111111-1111-4111-8111-111111111111'),
  ('25111111-1111-4111-8111-111111111111'),
  ('26111111-1111-4111-8111-111111111111'),
  ('27111111-1111-4111-8111-111111111111'),
  ('28111111-1111-4111-8111-111111111111'),
  ('29111111-1111-4111-8111-111111111111'),
  ('2a111111-1111-4111-8111-111111111111');
insert into public.organizations(id,name,slug,timezone) values
  ('a2101010-1010-4010-8010-101010101010','Recovery Club','recovery-club','America/Edmonton'),
  ('a2201010-1010-4010-8010-101010101010','Other Recovery Club','other-recovery-club','America/Edmonton');
insert into public.organization_members(organization_id,user_id,role,status) values
  ('a2101010-1010-4010-8010-101010101010','21111111-1111-4111-8111-111111111111','owner','active'),
  ('a2101010-1010-4010-8010-101010101010','22111111-1111-4111-8111-111111111111','administrator','active'),
  ('a2101010-1010-4010-8010-101010101010','23111111-1111-4111-8111-111111111111','member','active'),
  ('a2101010-1010-4010-8010-101010101010','24111111-1111-4111-8111-111111111111','member','active'),
  ('a2101010-1010-4010-8010-101010101010','25111111-1111-4111-8111-111111111111','member','active'),
  ('a2101010-1010-4010-8010-101010101010','26111111-1111-4111-8111-111111111111','member','active'),
  ('a2101010-1010-4010-8010-101010101010','27111111-1111-4111-8111-111111111111','member','active'),
  ('a2101010-1010-4010-8010-101010101010','28111111-1111-4111-8111-111111111111','member','disabled'),
  ('a2101010-1010-4010-8010-101010101010','29111111-1111-4111-8111-111111111111','member','active'),
  ('a2201010-1010-4010-8010-101010101010','2a111111-1111-4111-8111-111111111111','owner','active');
insert into public.tryouts(id,organization_id,name,slug,sport,timezone,registration_starts_at,registration_ends_at) values
  ('b2101010-1010-4010-8010-101010101010','a2101010-1010-4010-8010-101010101010','Recovery Camp','recovery-camp','Hockey','America/Edmonton',clock_timestamp()-interval '1 hour',clock_timestamp()+interval '1 day'),
  ('b2201010-1010-4010-8010-101010101010','a2101010-1010-4010-8010-101010101010','Other Camp','other-camp','Hockey','America/Edmonton',clock_timestamp()-interval '1 hour',clock_timestamp()+interval '1 day');
insert into public.tryout_divisions(id,organization_id,tryout_id,name,sort_order) values
  ('c2101010-1010-4010-8010-101010101010','a2101010-1010-4010-8010-101010101010','b2101010-1010-4010-8010-101010101010','U13',0),
  ('c2201010-1010-4010-8010-101010101010','a2101010-1010-4010-8010-101010101010','b2201010-1010-4010-8010-101010101010','U15',0);
insert into public.tryout_sessions(id,organization_id,tryout_id,division_id,name,starts_at,ends_at) values
  ('d2101010-1010-4010-8010-101010101010','a2101010-1010-4010-8010-101010101010','b2101010-1010-4010-8010-101010101010','c2101010-1010-4010-8010-101010101010','Skills',clock_timestamp()+interval '2 days',clock_timestamp()+interval '2 days 1 hour'),
  ('d2201010-1010-4010-8010-101010101010','a2101010-1010-4010-8010-101010101010','b2201010-1010-4010-8010-101010101010','c2201010-1010-4010-8010-101010101010','Other skills',clock_timestamp()+interval '2 days',clock_timestamp()+interval '2 days 1 hour');
insert into public.registration_forms(id,organization_id,tryout_id,name)
values('e2101010-1010-4010-8010-101010101010','a2101010-1010-4010-8010-101010101010','b2101010-1010-4010-8010-101010101010','Recovery form');
insert into public.registration_form_versions(id,organization_id,tryout_id,registration_form_id,version_number,schema,status,published_at)
values('f2101010-1010-4010-8010-101010101010','a2101010-1010-4010-8010-101010101010','b2101010-1010-4010-8010-101010101010','e2101010-1010-4010-8010-101010101010',1,
  '{"fields":[{"key":"short_text","label":"Short text","kind":"text","required":true,"sortOrder":0},{"key":"email","label":"Email","kind":"email","required":true,"sortOrder":1},{"key":"phone","label":"Phone","kind":"phone","required":true,"sortOrder":2},{"key":"date","label":"Date","kind":"date","required":true,"sortOrder":3},{"key":"position","label":"Position","kind":"select","required":true,"sortOrder":4,"options":["Goalie","Skater"]},{"key":"checked","label":"Checked","kind":"checkbox","required":false,"sortOrder":5},{"key":"notes","label":"Notes","kind":"textarea","required":false,"sortOrder":6},{"key":"consent","label":"Consent","kind":"consent","required":true,"sortOrder":7}]}','published',clock_timestamp());
insert into public.tryout_registration_form_selections(organization_id,tryout_id,registration_form_version_id)
values('a2101010-1010-4010-8010-101010101010','b2101010-1010-4010-8010-101010101010','f2101010-1010-4010-8010-101010101010');
update public.tryouts set status='published',published_at=clock_timestamp() where id='b2101010-1010-4010-8010-101010101010';

insert into public.tryout_staff_assignments(organization_id,user_id,role,scope_kind,tryout_id,division_id,revoked_at,granted_by_user_id) values
  ('a2101010-1010-4010-8010-101010101010','23111111-1111-4111-8111-111111111111','director','tryout','b2101010-1010-4010-8010-101010101010',null,null,'21111111-1111-4111-8111-111111111111'),
  ('a2101010-1010-4010-8010-101010101010','24111111-1111-4111-8111-111111111111','evaluator','tryout','b2101010-1010-4010-8010-101010101010',null,null,'21111111-1111-4111-8111-111111111111'),
  ('a2101010-1010-4010-8010-101010101010','25111111-1111-4111-8111-111111111111','checkin','tryout','b2101010-1010-4010-8010-101010101010',null,null,'21111111-1111-4111-8111-111111111111'),
  ('a2101010-1010-4010-8010-101010101010','26111111-1111-4111-8111-111111111111','reviewer','tryout','b2101010-1010-4010-8010-101010101010',null,null,'21111111-1111-4111-8111-111111111111'),
  ('a2101010-1010-4010-8010-101010101010','27111111-1111-4111-8111-111111111111','director','division','b2101010-1010-4010-8010-101010101010','c2101010-1010-4010-8010-101010101010',null,'21111111-1111-4111-8111-111111111111'),
  ('a2101010-1010-4010-8010-101010101010','28111111-1111-4111-8111-111111111111','director','tryout','b2101010-1010-4010-8010-101010101010',null,null,'21111111-1111-4111-8111-111111111111'),
  ('a2101010-1010-4010-8010-101010101010','29111111-1111-4111-8111-111111111111','director','tryout','b2101010-1010-4010-8010-101010101010',null,clock_timestamp(),'21111111-1111-4111-8111-111111111111');

create temporary table recovery_payload(payload jsonb);
insert into recovery_payload values (
  jsonb_build_object(
    'givenName','Ava','familyName','Smith','birthDate','2013-05-01','guardianName','Taylor Smith',
    'guardianEmail','guardian@example.com','guardianPhone','+1 (403) 555-0100','divisionId','c2101010-1010-4010-8010-101010101010',
    'responses',jsonb_build_object('short_text','Forward','email','player@example.com','phone','+1 (403) 555-0101','date','2024-02-29','position','Goalie','checked',false,'notes',repeat('🥅',5000),'consent',true)
  )
);
create temporary table first_registration as
select * from public.submit_public_registration_with_phone('recovery-camp',(select payload from recovery_payload),'recovery-idempotency-key-000001',repeat('a',64));
select is((select outcome from first_registration),'submitted','strict SQL accepts the valid leap-day and 5,000-code-point payload');
select is((select phone from public.guardians where normalized_email='guardian@example.com'),'+1 (403) 555-0100','guardian phone is persisted');
select is((select registration_form_version_id from public.tryout_registrations where id=(select registration_id from first_registration)),'f2101010-1010-4010-8010-101010101010'::uuid,'registration pins the exact form version');

create temporary table replay_registration as
select * from public.submit_public_registration_with_phone('recovery-camp',(select payload from recovery_payload),'recovery-idempotency-key-000001',repeat('a',64));
select is((select outcome from replay_registration),'replayed','same idempotency key and payload replays');
select matches((select confirmation_token from replay_registration),'^[0-9a-f]{64}$','replay atomically returns a fresh usable plaintext token');
select is((select phone from public.guardians where normalized_email='guardian@example.com'),'+1 (403) 555-0100','replay preserves the stored phone');
select is((select count(*) from public.registration_confirmation_tokens where registration_id=(select registration_id from first_registration) and used_at is null and revoked_at is null),1::bigint,'only one active token survives replay rotation');
select is((select outcome from public.submit_public_registration_with_phone('recovery-camp',jsonb_set((select payload from recovery_payload),'{guardianName}','"Different Guardian"'),'recovery-idempotency-key-000001',repeat('b',64))),'idempotency_conflict','same idempotency key with a different payload conflicts');

select throws_ok($$select * from public.submit_public_registration_with_phone('recovery-camp',jsonb_set((select payload from recovery_payload),'{responses,email}','"bad"'),'recovery-invalid-email-key-001',repeat('b',64))$$,'22023',null,'SQL rejects malformed dynamic email');
select throws_ok($$select * from public.submit_public_registration_with_phone('recovery-camp',jsonb_set((select payload from recovery_payload),'{responses,phone}','"+1 403 CALL-NOW"'),'recovery-invalid-phone-key-001',repeat('c',64))$$,'22023',null,'SQL rejects malformed dynamic phone');
select throws_ok($$select * from public.submit_public_registration_with_phone('recovery-camp',jsonb_set((select payload from recovery_payload),'{responses,date}','"2023-02-29"'),'recovery-invalid-date-key-0001',repeat('d',64))$$,'22023',null,'SQL rejects a non-calendar date');
select throws_ok($$select * from public.submit_public_registration_with_phone('recovery-camp',jsonb_set((select payload from recovery_payload),'{responses,short_text}',to_jsonb(repeat('🥅',501))),'recovery-oversize-text-key-001',repeat('e',64))$$,'22023',null,'SQL caps short Unicode text at 500 code points');
select throws_ok($$select * from public.submit_public_registration_with_phone('recovery-camp',jsonb_set((select payload from recovery_payload),'{responses,notes}',to_jsonb(repeat('🥅',5001))),'recovery-oversize-area-key-001',repeat('f',64))$$,'22023',null,'SQL caps Unicode textarea at 5,000 code points');
select throws_ok($$select * from public.submit_public_registration_with_phone('recovery-camp',jsonb_set((select payload from recovery_payload),'{responses,position}','"Coach"'),'recovery-invalid-select-key-1',repeat('1',64))$$,'22023',null,'SQL rejects unknown select options');
select throws_ok($$select * from public.submit_public_registration_with_phone('recovery-camp',jsonb_set((select payload from recovery_payload),'{responses,checked}','"false"'),'recovery-invalid-check-key-01',repeat('2',64))$$,'22023',null,'SQL requires checkbox booleans');

create temporary table duplicate_registration as
select * from public.submit_public_registration_with_phone('recovery-camp',(select payload from recovery_payload),'recovery-idempotency-key-000002',repeat('3',64));
select is((select outcome from duplicate_registration),'submitted','a distinct idempotency key creates a reviewable submission');
select is((select count(*) from public.athletes where organization_id='a2101010-1010-4010-8010-101010101010'),2::bigint,'duplicate candidates remain separate athlete records');
select is((select count(*) from public.registration_duplicate_candidates where registration_id=(select registration_id from duplicate_registration)),1::bigint,'matching identity creates one duplicate-review candidate');
select is((select count(distinct athlete_id) from public.tryout_registrations where tryout_id='b2101010-1010-4010-8010-101010101010'),2::bigint,'duplicate detection never auto-merges athletes');
select throws_ok(
  $$insert into public.session_enrollments(organization_id,tryout_id,registration_id,session_id) values('a2101010-1010-4010-8010-101010101010','b2201010-1010-4010-8010-101010101010',(select registration_id from first_registration),'d2201010-1010-4010-8010-101010101010')$$,
  '23503',null,'enrollment cannot attach a registration across tryouts');

select is((select outcome from public.consume_registration_confirmation_token((select confirmation_token from replay_registration))),'confirmed','active token confirms once');
select is((select outcome from public.consume_registration_confirmation_token((select confirmation_token from replay_registration))),'already_confirmed','consuming a used token reports already confirmed');
select is((select outcome from public.reissue_registration_confirmation_token((select confirmation_token from replay_registration),'guardian@example.com')),'already_confirmed','confirmed registrations cannot be reissued');
update public.registration_confirmation_tokens set created_at=clock_timestamp()-interval '2 seconds',expires_at=clock_timestamp()-interval '1 second' where token_digest=encode(extensions.digest((select confirmation_token from duplicate_registration),'sha256'),'hex');
select is((select outcome from public.consume_registration_confirmation_token((select confirmation_token from duplicate_registration))),'expired','expired token reports expiry truthfully');
select is((select outcome from public.reissue_registration_confirmation_token((select confirmation_token from duplicate_registration),'wrong@example.com')),'invalid','reissue requires matching guardian proof without enumeration');
create temporary table reissued_token as
select * from public.reissue_registration_confirmation_token((select confirmation_token from duplicate_registration),' GUARDIAN@example.com ');
select is((select outcome from reissued_token),'reissued','expired token is reissued with matching guardian proof');
select is((select outcome from public.consume_registration_confirmation_token((select confirmation_token from duplicate_registration))),'invalid','rotated token is revoked immediately');
select is((select outcome from public.consume_registration_confirmation_token((select confirmation_token from reissued_token))),'confirmed','newly reissued token is usable');

select is((select outcome from public.consume_public_registration_rate_limit(repeat('4',64),10)),'allowed','dedicated limiter allows its first request');
do $$begin for attempt in 1..9 loop perform * from public.consume_public_registration_rate_limit(repeat('4',64),10); end loop; end$$;
select is((select outcome from public.consume_public_registration_rate_limit(repeat('4',64),10)),'rate_limited','dedicated limiter returns a stable rate limit after saturation');
select is((select attempts from public.registration_rate_counters where key_hash=repeat('4',64)),11,'limiter counter saturates at its stable sentinel');
update public.registration_rate_counters set window_started_at=clock_timestamp()-interval '11 minutes',expires_at=clock_timestamp()-interval '1 minute' where key_hash=repeat('4',64);
select is((select outcome from public.consume_public_registration_rate_limit(repeat('4',64),10)),'allowed','expired limiter window resets');
select is((select attempts from public.registration_rate_counters where key_hash=repeat('4',64)),1,'reset limiter starts at one attempt');

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','21111111-1111-4111-8111-111111111111',true);
select is((select count(*) from public.tryout_registrations where tryout_id='b2101010-1010-4010-8010-101010101010'),2::bigint,'active owner can read full registration PII');
select set_config('request.jwt.claim.sub','22111111-1111-4111-8111-111111111111',true);
select is((select count(*) from public.tryout_registrations where tryout_id='b2101010-1010-4010-8010-101010101010'),2::bigint,'active administrator can read full registration PII');
select set_config('request.jwt.claim.sub','23111111-1111-4111-8111-111111111111',true);
select is((select count(*) from public.tryout_registrations where tryout_id='b2101010-1010-4010-8010-101010101010'),2::bigint,'active root director can read exact-tryout PII');
select set_config('request.jwt.claim.sub','24111111-1111-4111-8111-111111111111',true);
select is((select count(*) from public.tryout_registrations),0::bigint,'evaluator cannot read full registration PII');
select set_config('request.jwt.claim.sub','25111111-1111-4111-8111-111111111111',true);
select is((select count(*) from public.tryout_registrations),0::bigint,'check-in staff cannot read full registration PII');
select set_config('request.jwt.claim.sub','26111111-1111-4111-8111-111111111111',true);
select is((select count(*) from public.tryout_registrations),0::bigint,'reviewer cannot read full registration PII');
select set_config('request.jwt.claim.sub','27111111-1111-4111-8111-111111111111',true);
select is((select count(*) from public.tryout_registrations),0::bigint,'child-scoped director cannot read full registration PII');
select set_config('request.jwt.claim.sub','28111111-1111-4111-8111-111111111111',true);
select is((select count(*) from public.tryout_registrations),0::bigint,'inactive root director cannot read full registration PII');
select set_config('request.jwt.claim.sub','29111111-1111-4111-8111-111111111111',true);
select is((select count(*) from public.tryout_registrations),0::bigint,'revoked root director cannot read full registration PII');
select set_config('request.jwt.claim.sub','2a111111-1111-4111-8111-111111111111',true);
select is((select count(*) from public.tryout_registrations),0::bigint,'cross-tenant owner cannot read registration PII');
reset role;

select * from finish();
rollback;
