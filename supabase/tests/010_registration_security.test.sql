begin;
select plan(14);

select has_table('public', 'athletes', 'athletes are normalized');
select has_table('public', 'tryout_registrations', 'registrations are stored separately');
select ok(not has_table_privilege('anon', 'public.athletes', 'select,insert,update,delete'), 'anonymous users have no direct athlete-table privileges');
select ok(not has_table_privilege('anon', 'public.tryout_registrations', 'select,insert,update,delete'), 'anonymous users have no direct registration-table privileges');
select function_privs_are('public', 'submit_public_registration', array['text', 'jsonb', 'text', 'text'], 'anon', array[]::text[], 'anonymous callers cannot invoke the privileged write');
select function_privs_are('public', 'submit_public_registration', array['text', 'jsonb', 'text', 'text'], 'service_role', array['EXECUTE'], 'only the server role invokes the controlled write');
select ok(exists (
  select 1 from pg_constraint constraint_row
  where constraint_row.conrelid = 'public.tryout_registrations'::regclass
    and constraint_row.contype = 'f'
    and pg_get_constraintdef(constraint_row.oid) like '%registration_form_version_id%registration_form_versions%'
), 'registration rows pin the exact form version with a foreign key');

insert into public.organizations (id, name, slug, timezone)
values ('a0101010-1010-4010-8010-101010101010', 'Registration Club', 'registration-club', 'America/Edmonton');
insert into public.tryouts (id, organization_id, name, slug, sport, timezone, registration_starts_at, registration_ends_at)
values ('b0101010-1010-4010-8010-101010101010', 'a0101010-1010-4010-8010-101010101010', 'Registration Camp', 'registration-camp', 'Hockey', 'America/Edmonton', clock_timestamp() - interval '1 hour', clock_timestamp() + interval '1 hour');
insert into public.tryout_divisions (id, organization_id, tryout_id, name, sort_order)
values ('c0101010-1010-4010-8010-101010101010', 'a0101010-1010-4010-8010-101010101010', 'b0101010-1010-4010-8010-101010101010', 'U13', 0);
insert into public.tryout_sessions (id, organization_id, tryout_id, division_id, name, starts_at, ends_at)
values ('d0101010-1010-4010-8010-101010101010', 'a0101010-1010-4010-8010-101010101010', 'b0101010-1010-4010-8010-101010101010', 'c0101010-1010-4010-8010-101010101010', 'Skills', clock_timestamp() + interval '1 day', clock_timestamp() + interval '1 day 2 hours');
insert into public.registration_forms (id, organization_id, tryout_id, name)
values ('e0101010-1010-4010-8010-101010101010', 'a0101010-1010-4010-8010-101010101010', 'b0101010-1010-4010-8010-101010101010', 'Public form');
insert into public.registration_form_versions (id, organization_id, tryout_id, registration_form_id, version_number, schema, status, published_at)
values ('f0101010-1010-4010-8010-101010101010', 'a0101010-1010-4010-8010-101010101010', 'b0101010-1010-4010-8010-101010101010', 'e0101010-1010-4010-8010-101010101010', 1, '{"fields":[{"key":"consent","label":"Consent","kind":"consent","required":true,"sortOrder":0}]}', 'published', clock_timestamp());
insert into public.tryout_registration_form_selections (organization_id, tryout_id, registration_form_version_id)
values ('a0101010-1010-4010-8010-101010101010', 'b0101010-1010-4010-8010-101010101010', 'f0101010-1010-4010-8010-101010101010');
update public.tryouts set status='published', published_at=clock_timestamp() where id='b0101010-1010-4010-8010-101010101010';

create temporary table registration_result as
select * from public.submit_public_registration(
  'registration-camp',
  '{"givenName":"Ava","familyName":"Smith","birthDate":"2013-05-01","guardianName":"Taylor Smith","guardianEmail":"guardian@example.com","divisionId":"c0101010-1010-4010-8010-101010101010","responses":{"consent":true}}',
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  repeat('1', 64)
);
select is((select outcome from registration_result), 'submitted', 'controlled command accepts valid published-window registration');
select is((select count(*) from public.session_enrollments where registration_id=(select registration_id from registration_result)), 1::bigint, 'valid submission creates its session enrollment atomically');
select is((select registration_form_version_id from public.tryout_registrations where id=(select registration_id from registration_result)), 'f0101010-1010-4010-8010-101010101010'::uuid, 'submission uses the exact selected immutable form version');
select ok((select token.token_digest <> result.confirmation_token and char_length(token.token_digest)=64 from public.registration_confirmation_tokens token join registration_result result on token.registration_id=result.registration_id), 'confirmation secret is hashed at rest');
select is((select outcome from public.submit_public_registration('registration-camp', '{"givenName":"Ava","familyName":"Smith","birthDate":"2013-05-01","guardianName":"Taylor Smith","guardianEmail":"guardian@example.com","divisionId":"c0101010-1010-4010-8010-101010101010","responses":{"consent":true}}', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', repeat('1', 64))), 'replayed', 'same idempotency key is replay-safe');
select throws_ok(
  $$select * from public.submit_public_registration('registration-camp', '{"givenName":"Ava","familyName":"Smith","birthDate":"2013-05-01","guardianName":"Taylor Smith","guardianEmail":"guardian@example.com","divisionId":"c0101010-1010-4010-8010-101010101010","responses":{"consent":true,"unknown":"x"}}', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', repeat('2', 64))$$,
  '22023', null, 'unknown form responses are rejected');
select is((select outcome from public.submit_public_registration('missing-registration', '{"givenName":"Ava","familyName":"Smith","birthDate":"2013-05-01","guardianName":"Taylor Smith","guardianEmail":"guardian@example.com","divisionId":"c0101010-1010-4010-8010-101010101010","responses":{"consent":true}}', 'cccccccccccccccccccccccccccccccc', repeat('3', 64))), 'registration_closed', 'closed or unknown registration accepts no new records');

select * from finish();
rollback;
