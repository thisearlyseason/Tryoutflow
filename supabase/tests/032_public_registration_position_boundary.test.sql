begin;
select no_plan();

select has_function(
  'public','submit_public_registration_v2',array['text','jsonb','text','text'],
  'one canonical position-aware registration submission RPC exists'
);

select function_privs_are(
  'public','submit_public_registration_v2',array['text','jsonb','text','text'],
  'service_role',array['EXECUTE'],
  'service role may execute only the canonical registration submission RPC'
);
select function_privs_are(
  'public','submit_public_registration_v2',array['text','jsonb','text','text'],
  'anon',array[]::text[],
  'anonymous clients cannot execute the canonical registration submission RPC'
);
select function_privs_are(
  'public','submit_public_registration_v2',array['text','jsonb','text','text'],
  'authenticated',array[]::text[],
  'authenticated clients cannot execute the canonical registration submission RPC'
);

select function_privs_are(
  'public','submit_public_registration',array['text','jsonb','text','text'],
  'service_role',array[]::text[],
  'service role cannot execute the legacy base transaction'
);
select function_privs_are(
  'public','submit_public_registration_with_phone',array['text','jsonb','text','text'],
  'service_role',array[]::text[],
  'service role cannot execute the legacy phone wrapper'
);
select function_privs_are(
  'public','submit_public_registration_with_position',array['text','jsonb','text','text','uuid'],
  'service_role',array[]::text[],
  'service role cannot execute the legacy duplicated-position wrapper'
);
select is(
  (
    select count(*)
    from pg_proc routine
    join pg_namespace namespace on namespace.oid=routine.pronamespace
    where namespace.nspname='public'
      and routine.proname like 'submit_public_registration%'
      and has_function_privilege('service_role',routine.oid,'execute')
  ),
  1::bigint,'exactly one public registration submission RPC is service-executable'
);

insert into public.organizations(id,name,slug,timezone)
values('a5050505-5050-4050-8050-505050505050','Position Boundary Club','position-boundary-club','America/Edmonton');
insert into public.tryouts(
  id,organization_id,name,slug,sport,timezone,registration_starts_at,registration_ends_at
) values(
  'b5050505-5050-4050-8050-505050505050','a5050505-5050-4050-8050-505050505050',
  'Position Boundary Camp','position-boundary-camp','Hockey','America/Edmonton',
  clock_timestamp()-interval '1 hour',clock_timestamp()+interval '1 day'
);
insert into public.tryout_divisions(id,organization_id,tryout_id,name,sort_order)
values(
  'c5050505-5050-4050-8050-505050505050','a5050505-5050-4050-8050-505050505050',
  'b5050505-5050-4050-8050-505050505050','U13',0
);
insert into public.tryout_positions(id,organization_id,tryout_id,name,sort_order)
values
  ('d5050505-5050-4050-8050-505050505050','a5050505-5050-4050-8050-505050505050','b5050505-5050-4050-8050-505050505050','Goalie',0),
  ('e5050505-5050-4050-8050-505050505050','a5050505-5050-4050-8050-505050505050','b5050505-5050-4050-8050-505050505050','Skater',1);
insert into public.registration_forms(id,organization_id,tryout_id,name)
values(
  'f5050505-5050-4050-8050-505050505050','a5050505-5050-4050-8050-505050505050',
  'b5050505-5050-4050-8050-505050505050','Public'
);
insert into public.registration_form_versions(
  id,organization_id,tryout_id,registration_form_id,version_number,schema,status,published_at
) values(
  '15050505-5050-4050-8050-505050505050','a5050505-5050-4050-8050-505050505050',
  'b5050505-5050-4050-8050-505050505050','f5050505-5050-4050-8050-505050505050',1,
  '{"fields":[{"key":"consent","label":"Consent","kind":"consent","required":true,"sortOrder":0}]}',
  'published',clock_timestamp()
);
insert into public.tryout_registration_form_selections(
  organization_id,tryout_id,registration_form_version_id
) values(
  'a5050505-5050-4050-8050-505050505050','b5050505-5050-4050-8050-505050505050',
  '15050505-5050-4050-8050-505050505050'
);
update public.tryouts set status='published',published_at=clock_timestamp()
where id='b5050505-5050-4050-8050-505050505050';

create temporary table position_payload(payload jsonb);
insert into position_payload values(jsonb_build_object(
  'givenName','Ava','familyName','Smith','birthDate','2013-05-01',
  'guardianName','Taylor Smith','guardianEmail','guardian@example.com',
  'divisionId','c5050505-5050-4050-8050-505050505050',
  'positionId','d5050505-5050-4050-8050-505050505050',
  'responses',jsonb_build_object('consent',true)
));

create temporary table positioned_first as
select * from public.submit_public_registration_v2(
  'position-boundary-camp',(select payload from position_payload),
  'position-boundary-key-000001',repeat('1',64)
);
select is((select outcome from positioned_first),'submitted','canonical submission succeeds');
select is(
  (select position_id from public.tryout_registrations where id=(select registration_id from positioned_first)),
  'd5050505-5050-4050-8050-505050505050'::uuid,
  'canonical position is persisted atomically'
);
select is(
  (select submission_digest_version from public.tryout_registrations where id=(select registration_id from positioned_first)),
  2::smallint,
  'new registrations store the position-bound canonical digest version'
);
select is(
  (
    select registration.submission_digest
    from public.tryout_registrations registration
    where registration.id=(select registration_id from positioned_first)
  ),
  encode(extensions.digest(
    jsonb_build_object(
      'digestVersion',2,
      'tryoutId','b5050505-5050-4050-8050-505050505050'::uuid,
      'idempotencyKeyDigest',encode(extensions.digest('position-boundary-key-000001','sha256'),'hex'),
      'submission',(select payload from position_payload)
    )::text,'sha256'
  ),'hex'),
  'stored digest binds the complete normalized submission, position, tryout, and key'
);
select is(
  (select count(*) from public.audit_logs
    where entity_id=(select registration_id from positioned_first)
      and action='registration.submitted'),
  1::bigint,'registration and its audit event commit together exactly once'
);

create temporary table positioned_replay as
select * from public.submit_public_registration_v2(
  'position-boundary-camp',(select payload from position_payload),
  'position-boundary-key-000001',repeat('2',64)
);
select is((select outcome from positioned_replay),'replayed','same normalized payload and position replays');
select is(
  (select count(*) from public.tryout_registrations where tryout_id='b5050505-5050-4050-8050-505050505050'),
  1::bigint,'exact replay creates no duplicate registration'
);
select is(
  (select count(*) from public.registration_confirmation_tokens
    where registration_id=(select registration_id from positioned_first)
      and used_at is null and revoked_at is null),
  1::bigint,'exact replay leaves one active confirmation token'
);
select is(
  (select outcome from public.submit_public_registration_v2(
    'position-boundary-camp',
    jsonb_set((select payload from position_payload),'{positionId}','"e5050505-5050-4050-8050-505050505050"'),
    'position-boundary-key-000001',repeat('3',64)
  )),
  'idempotency_conflict','same key with a changed position conflicts'
);

select throws_ok(
  $$select * from public.submit_public_registration_v2(
    'position-boundary-camp',
    (select payload||'{"p_position_id":"d5050505-5050-4050-8050-505050505050"}'::jsonb from position_payload),
    'position-unknown-field-key-001',repeat('4',64)
  )$$,
  '22023',null,'duplicate-style position field is rejected as unknown'
);
select throws_ok(
  $$select * from public.submit_public_registration_v2(
    'position-boundary-camp',
    jsonb_set((select payload from position_payload),'{positionId}','"not-a-uuid"'),
    'position-invalid-uuid-key-0001',repeat('5',64)
  )$$,
  '22023',null,'position must be an exact UUID string, null, or omitted'
);

-- Simulate a pre-050 registration through the owner-only legacy wrapper, then
-- prove the upgrade rule: exact old payload + stored position replays, while a
-- newly introduced or changed position conflicts.
create temporary table legacy_payload(payload jsonb);
insert into legacy_payload
select (payload-'positionId')||jsonb_build_object('givenName','Legacy','guardianEmail','legacy@example.com')
from position_payload;
create temporary table legacy_first as
select * from public.submit_public_registration_with_phone(
  'position-boundary-camp',(select payload from legacy_payload),
  'position-legacy-key-00000001',repeat('6',64)
);
update public.tryout_registrations set position_id='d5050505-5050-4050-8050-505050505050'
where id=(select registration_id from legacy_first);
select is(
  (select submission_digest_version from public.tryout_registrations where id=(select registration_id from legacy_first)),
  1::smallint,'legacy row retains its version-one digest before replay'
);
select is(
  (select outcome from public.submit_public_registration_v2(
    'position-boundary-camp',
    (select payload||jsonb_build_object('positionId','d5050505-5050-4050-8050-505050505050') from legacy_payload),
    'position-legacy-key-00000001',repeat('7',64)
  )),
  'replayed','legacy digest replays only with its exact stored position'
);
select is(
  (select submission_digest_version from public.tryout_registrations where id=(select registration_id from legacy_first)),
  2::smallint,'successful legacy replay upgrades the row to the canonical digest'
);
select is(
  (select outcome from public.submit_public_registration_v2(
    'position-boundary-camp',
    (select payload||jsonb_build_object('positionId','e5050505-5050-4050-8050-505050505050') from legacy_payload),
    'position-legacy-key-00000001',repeat('8',64)
  )),
  'idempotency_conflict','changed position conflicts after legacy upgrade'
);

create temporary table legacy_unassigned_payload(payload jsonb);
insert into legacy_unassigned_payload
select (payload-'positionId')||jsonb_build_object(
  'givenName','Legacy Unassigned','guardianEmail','legacy-unassigned@example.com'
)
from position_payload;
create temporary table legacy_unassigned_first as
select * from public.submit_public_registration_with_phone(
  'position-boundary-camp',(select payload from legacy_unassigned_payload),
  'position-legacy-unassigned-key-1',repeat('f',64)
);
select is(
  (select outcome from public.submit_public_registration_v2(
    'position-boundary-camp',
    (select payload||jsonb_build_object('positionId','d5050505-5050-4050-8050-505050505050')
      from legacy_unassigned_payload),
    'position-legacy-unassigned-key-1',repeat('e',64)
  )),
  'idempotency_conflict',
  'introducing a position on a legacy unassigned key conflicts without ambiguity'
);
select is(
  (select submission_digest_version from public.tryout_registrations
    where id=(select registration_id from legacy_unassigned_first)),
  1::smallint,'a conflicting legacy retry does not rewrite its digest metadata'
);

create temporary table omitted_payload(payload jsonb);
insert into omitted_payload
select (payload-'positionId')||jsonb_build_object('givenName','Omitted','guardianEmail','omitted@example.com')
from position_payload;
create temporary table omitted_first as
select * from public.submit_public_registration_v2(
  'position-boundary-camp',(select payload from omitted_payload),
  'position-omitted-key-0000001',repeat('9',64)
);
select is(
  (select outcome from public.submit_public_registration_v2(
    'position-boundary-camp',(select payload||jsonb_build_object('positionId',null) from omitted_payload),
    'position-omitted-key-0000001',repeat('a',64)
  )),
  'replayed','omitted and explicit null share the canonical no-position sentinel'
);
select is(
  (select position_id from public.tryout_registrations where id=(select registration_id from omitted_first)),
  null::uuid,'omitted position remains unassigned'
);

select * from finish();
rollback;
