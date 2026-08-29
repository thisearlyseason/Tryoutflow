begin;
select no_plan();

insert into public.organizations(id,name,slug,timezone)
values(
  'a5151515-5151-4151-8151-515151515151',
  'Historical Digest Club','historical-digest-club','America/Edmonton'
);
insert into public.tryouts(
  id,organization_id,name,slug,sport,timezone,
  registration_starts_at,registration_ends_at
) values(
  'b5151515-5151-4151-8151-515151515151',
  'a5151515-5151-4151-8151-515151515151',
  'Historical Digest Camp','historical-digest-camp','Hockey','America/Edmonton',
  clock_timestamp()-interval '1 hour',clock_timestamp()+interval '1 day'
);
insert into public.tryout_divisions(id,organization_id,tryout_id,name,sort_order)
values(
  'c5151515-5151-4151-8151-515151515151',
  'a5151515-5151-4151-8151-515151515151',
  'b5151515-5151-4151-8151-515151515151','U13',0
);
insert into public.tryout_positions(id,organization_id,tryout_id,name,sort_order)
values
  ('d5151515-5151-4151-8151-515151515151','a5151515-5151-4151-8151-515151515151','b5151515-5151-4151-8151-515151515151','Goalie',0),
  ('e5151515-5151-4151-8151-515151515151','a5151515-5151-4151-8151-515151515151','b5151515-5151-4151-8151-515151515151','Skater',1);
insert into public.registration_forms(id,organization_id,tryout_id,name)
values(
  'f5151515-5151-4151-8151-515151515151',
  'a5151515-5151-4151-8151-515151515151',
  'b5151515-5151-4151-8151-515151515151','Public'
);
insert into public.registration_form_versions(
  id,organization_id,tryout_id,registration_form_id,version_number,
  schema,status,published_at
) values(
  '15151515-5151-4151-8151-515151515151',
  'a5151515-5151-4151-8151-515151515151',
  'b5151515-5151-4151-8151-515151515151',
  'f5151515-5151-4151-8151-515151515151',1,
  '{"fields":[
    {"key":"consent","label":"Consent","kind":"consent","required":true,"sortOrder":0},
    {"key":"note","label":"Note","kind":"text","required":false,"sortOrder":1},
    {"key":"email","label":"Email","kind":"email","required":false,"sortOrder":2},
    {"key":"phone","label":"Phone","kind":"phone","required":false,"sortOrder":3}
  ]}',
  'published',clock_timestamp()
);
insert into public.tryout_registration_form_selections(
  organization_id,tryout_id,registration_form_version_id
) values(
  'a5151515-5151-4151-8151-515151515151',
  'b5151515-5151-4151-8151-515151515151',
  '15151515-5151-4151-8151-515151515151'
);
update public.tryouts set status='published',published_at=clock_timestamp()
where id='b5151515-5151-4151-8151-515151515151';

-- This test helper models the durable rows written by the historical function.
-- It deliberately does not call today's normalizing wrapper.
create function pg_temp.insert_historical_registration(
  p_registration_id uuid,
  p_athlete_id uuid,
  p_guardian_id uuid,
  p_key text,
  p_payload jsonb,
  p_digest_payload jsonb,
  p_position_id uuid default null
) returns void language plpgsql as $$
begin
  insert into public.athletes(
    id,organization_id,given_name,family_name,
    normalized_given_name,normalized_family_name,birth_date
  ) values(
    p_athlete_id,'a5151515-5151-4151-8151-515151515151',
    public.canonical_registration_text(p_payload->>'givenName'),
    public.canonical_registration_text(p_payload->>'familyName'),
    lower(public.canonical_import_text(p_payload->>'givenName')),
    lower(public.canonical_import_text(p_payload->>'familyName')),
    (p_payload->>'birthDate')::date
  );
  insert into public.guardians(
    id,organization_id,name,email,normalized_email,phone
  ) values(
    p_guardian_id,'a5151515-5151-4151-8151-515151515151',
    public.canonical_registration_text(p_payload->>'guardianName'),
    public.canonical_registration_text(p_payload->>'guardianEmail'),
    lower(public.canonical_registration_text(p_payload->>'guardianEmail')),
    public.canonical_registration_text(p_payload->>'guardianPhone')
  );
  insert into public.athlete_guardians(organization_id,athlete_id,guardian_id)
  values('a5151515-5151-4151-8151-515151515151',p_athlete_id,p_guardian_id);
  insert into public.tryout_registrations(
    id,organization_id,tryout_id,athlete_id,division_id,position_id,
    registration_form_version_id,responses,submission_key_digest,
    submission_digest,submission_digest_version
  ) values(
    p_registration_id,'a5151515-5151-4151-8151-515151515151',
    'b5151515-5151-4151-8151-515151515151',p_athlete_id,
    'c5151515-5151-4151-8151-515151515151',p_position_id,
    '15151515-5151-4151-8151-515151515151',p_payload->'responses',
    encode(extensions.digest(p_key,'sha256'),'hex'),
    encode(extensions.digest(p_digest_payload::text,'sha256'),'hex'),1
  );
  insert into public.registration_confirmation_tokens(
    organization_id,registration_id,token_digest,expires_at
  ) values(
    'a5151515-5151-4151-8151-515151515151',p_registration_id,
    encode(extensions.digest(p_registration_id::text,'sha256'),'hex'),
    clock_timestamp()+interval '7 days'
  );
end;
$$;

create temporary table historical_payloads(name text primary key,payload jsonb);
insert into historical_payloads values
('raw',jsonb_build_object(
  'givenName','  Raw   Ava  ','familyName','  Smith  ','birthDate','2013-05-01',
  'guardianName','  Taylor   Smith  ','guardianEmail','  RAW@example.com  ',
  'guardianPhone','  +1 (403) 555-0100  ',
  'divisionId','c5151515-5151-4151-8151-515151515151',
  'responses',jsonb_build_object(
    'consent',true,'note','  fast   skater  ',
    'email','  raw-response@example.com  ','phone','  +1 403 555 0199  '
  )
)),
('normalized',jsonb_build_object(
  'givenName','Raw Ava','familyName','Smith','birthDate','2013-05-01',
  'guardianName','Taylor Smith','guardianEmail','RAW@example.com',
  'guardianPhone','+1 (403) 555-0100',
  'divisionId','c5151515-5151-4151-8151-515151515151',
  'responses',jsonb_build_object(
    'consent',true,'note','fast skater',
    'email','raw-response@example.com','phone','+1 403 555 0199'
  )
));

-- Migration 024 hashed the incoming jsonb text before migration 025 normalized
-- canonicalizable strings. PostgreSQL jsonb fixes object-key order/spacing, but
-- preserves the original JSON string values represented here.
select pg_temp.insert_historical_registration(
  '25151515-5151-4151-8151-515151515151',
  '35151515-5151-4151-8151-515151515151',
  '45151515-5151-4151-8151-515151515151',
  'historical-raw-unassigned-key-01',
  (select payload from historical_payloads where name='raw'),
  (select payload from historical_payloads where name='raw'),null
);
create temporary table raw_upgrade as
select * from public.submit_public_registration_v2(
  'historical-digest-camp',
  (select payload from historical_payloads where name='raw'),
  'historical-raw-unassigned-key-01',repeat('1',64)
);
select is((select outcome from raw_upgrade),'replayed',
  'an exact true pre-025 raw jsonb digest replays');
select is(
  (select submission_digest_version from public.tryout_registrations
    where id='25151515-5151-4151-8151-515151515151'),2::smallint,
  'an exact raw replay atomically upgrades the digest version'
);
select is(
  (select submission_digest from public.tryout_registrations
    where id='25151515-5151-4151-8151-515151515151'),
  encode(extensions.digest(jsonb_build_object(
    'digestVersion',2,
    'tryoutId','b5151515-5151-4151-8151-515151515151'::uuid,
    'idempotencyKeyDigest',encode(extensions.digest('historical-raw-unassigned-key-01','sha256'),'hex'),
    'submission',(select payload||jsonb_build_object('positionId',null)
      from historical_payloads where name='normalized')
  )::text,'sha256'),'hex'),
  'the upgraded v2 digest is independently recomputed with the null position sentinel'
);
select is(
  (select count(*) from public.registration_confirmation_tokens
    where registration_id='25151515-5151-4151-8151-515151515151'
      and used_at is null and revoked_at is null),1::bigint,
  'raw upgrade leaves exactly one active confirmation token'
);
select is(
  (select token_digest from public.registration_confirmation_tokens
    where registration_id='25151515-5151-4151-8151-515151515151'
      and used_at is null and revoked_at is null),
  encode(extensions.digest((select confirmation_token from raw_upgrade),'sha256'),'hex'),
  'raw upgrade returns the sole active confirmation token plaintext'
);

-- A position may have been attached to a pre-025 row later by the 049-era
-- workflow. The raw candidate still excludes position, while the independent
-- row fence requires the exact stored value.
select pg_temp.insert_historical_registration(
  'b6151515-5151-4151-8151-515151515151',
  'c6151515-5151-4151-8151-515151515151',
  'd6151515-5151-4151-8151-515151515151',
  'historical-raw-assigned-key-0001',
  (select payload from historical_payloads where name='raw'),
  (select payload from historical_payloads where name='raw'),
  'd5151515-5151-4151-8151-515151515151'
);
create temporary table raw_assigned_upgrade as
select * from public.submit_public_registration_v2(
  'historical-digest-camp',
  (select payload||jsonb_build_object('positionId','d5151515-5151-4151-8151-515151515151')
    from historical_payloads where name='raw'),
  'historical-raw-assigned-key-0001',repeat('a',64)
);
select is((select outcome from raw_assigned_upgrade),'replayed',
  'a raw pre-025 digest with a later exact assigned position replays');
select is(
  (select submission_digest from public.tryout_registrations
    where id='b6151515-5151-4151-8151-515151515151'),
  encode(extensions.digest(jsonb_build_object(
    'digestVersion',2,
    'tryoutId','b5151515-5151-4151-8151-515151515151'::uuid,
    'idempotencyKeyDigest',encode(extensions.digest('historical-raw-assigned-key-0001','sha256'),'hex'),
    'submission',(select payload||jsonb_build_object(
      'positionId','d5151515-5151-4151-8151-515151515151'
    ) from historical_payloads where name='normalized')
  )::text,'sha256'),'hex'),
  'the assigned upgrade v2 digest independently binds the exact position'
);

-- A pre-025 raw digest is exact, not normalization-equivalent.
select pg_temp.insert_historical_registration(
  '55151515-5151-4151-8151-515151515151',
  '65151515-5151-4151-8151-515151515151',
  '75151515-5151-4151-8151-515151515151',
  'historical-raw-conflict-key-001',
  (select payload from historical_payloads where name='raw'),
  (select payload from historical_payloads where name='raw'),null
);
create temporary table conflict_before as
select
  (select count(*) from public.tryout_registrations) registrations,
  (select count(*) from public.guardians) guardians,
  (select count(*) from public.registration_confirmation_tokens) tokens,
  (select count(*) from public.audit_logs) audits,
  (select submission_digest from public.tryout_registrations
    where id='55151515-5151-4151-8151-515151515151') digest;
select is(
  (select outcome from public.submit_public_registration_v2(
    'historical-digest-camp',
    (select payload from historical_payloads where name='normalized'),
    'historical-raw-conflict-key-001',repeat('2',64)
  )),'idempotency_conflict',
  'a normalization-equivalent but non-exact replay conflicts with a raw historical digest'
);
select is(
  (select outcome from public.submit_public_registration_v2(
    'historical-digest-camp',
    jsonb_set((select payload from historical_payloads where name='raw'),'{responses,note}','"changed"'),
    'historical-raw-conflict-key-001',repeat('3',64)
  )),'idempotency_conflict','a changed dynamic response conflicts'
);
select is(
  (select outcome from public.submit_public_registration_v2(
    'historical-digest-camp',
    jsonb_set((select payload from historical_payloads where name='raw'),'{givenName}','"Changed"'),
    'historical-raw-conflict-key-001',repeat('4',64)
  )),'idempotency_conflict','a changed base identity field conflicts'
);
select is(
  (select outcome from public.submit_public_registration_v2(
    'historical-digest-camp',
    jsonb_set((select payload from historical_payloads where name='raw'),'{guardianEmail}','"changed@example.com"'),
    'historical-raw-conflict-key-001',repeat('5',64)
  )),'idempotency_conflict','a changed contact field conflicts'
);
select is(
  (select outcome from public.submit_public_registration_v2(
    'historical-digest-camp',
    (select payload||jsonb_build_object('positionId','d5151515-5151-4151-8151-515151515151')
      from historical_payloads where name='raw'),
    'historical-raw-conflict-key-001',repeat('6',64)
  )),'idempotency_conflict','a position introduced on an unassigned historical row conflicts'
);

-- Validation precedes every historical digest comparison. These calls use an
-- existing key on purpose: malformed input must raise, not degrade to a digest
-- conflict or touch any row.
select throws_ok(
  $$select * from public.submit_public_registration_v2(
    'historical-digest-camp',
    jsonb_set((select payload from historical_payloads where name='raw'),'{givenName}','123'),
    'historical-raw-conflict-key-001',repeat('9',64)
  )$$,'22023',null,'raw identity JSON types are validated before digest candidates'
);
select throws_ok(
  $$select * from public.submit_public_registration_v2(
    'historical-digest-camp',
    (select payload||jsonb_build_object('unknownField','value')
      from historical_payloads where name='raw'),
    'historical-raw-conflict-key-001',repeat('9',64)
  )$$,'22023',null,'raw top-level keys are validated before digest candidates'
);
select throws_ok(
  $$select * from public.submit_public_registration_v2(
    'historical-digest-camp',
    jsonb_set((select payload from historical_payloads where name='raw'),
      '{responses,note}',to_jsonb(repeat('x',33000))),
    'historical-raw-conflict-key-001',repeat('9',64)
  )$$,'22023',null,'raw response byte size is validated before digest candidates'
);
select throws_ok(
  $$select * from public.submit_public_registration_v2(
    'historical-digest-camp',
    jsonb_set((select payload from historical_payloads where name='raw'),
      '{givenName}',to_jsonb(repeat('🏒',121))),
    'historical-raw-conflict-key-001',repeat('9',64)
  )$$,'22023',null,'canonical Unicode code-point bounds are validated before digest candidates'
);
select throws_ok(
  $$select * from public.submit_public_registration_v2(
    'historical-digest-camp',
    jsonb_set((select payload from historical_payloads where name='raw'),'{birthDate}','"2013-02-30"'),
    'historical-raw-conflict-key-001',repeat('9',64)
  )$$,'22023',null,'calendar dates are validated before digest candidates'
);
select throws_ok(
  $$select * from public.submit_public_registration_v2(
    'historical-digest-camp',
    jsonb_set((select payload from historical_payloads where name='raw'),'{guardianEmail}','"invalid"'),
    'historical-raw-conflict-key-001',repeat('9',64)
  )$$,'22023',null,'guardian email is validated before digest candidates'
);
select throws_ok(
  $$select * from public.submit_public_registration_v2(
    'historical-digest-camp',
    jsonb_set((select payload from historical_payloads where name='raw'),'{guardianPhone}','"123"'),
    'historical-raw-conflict-key-001',repeat('9',64)
  )$$,'22023',null,'guardian phone is validated before digest candidates'
);
select throws_ok(
  $$select * from public.submit_public_registration_v2(
    'historical-digest-camp',
    jsonb_set((select payload from historical_payloads where name='raw'),'{responses,email}','"invalid"'),
    'historical-raw-conflict-key-001',repeat('9',64)
  )$$,'22023',null,'dynamic response kinds are validated before digest candidates'
);
select throws_ok(
  $$select * from public.submit_public_registration_v2(
    'historical-digest-camp',
    jsonb_set((select payload from historical_payloads where name='raw'),'{responses,note}','123'),
    'historical-raw-conflict-key-001',repeat('9',64)
  )$$,'22023',null,'dynamic response JSON types are validated before digest candidates'
);
select results_eq(
  $$select
      (select count(*) from public.tryout_registrations),
      (select count(*) from public.guardians),
      (select count(*) from public.registration_confirmation_tokens),
      (select count(*) from public.audit_logs),
      (select submission_digest from public.tryout_registrations
        where id='55151515-5151-4151-8151-515151515151'),
      (select submission_digest_version from public.tryout_registrations
        where id='55151515-5151-4151-8151-515151515151')$$,
  $$select registrations,guardians,tokens,audits,digest,1::smallint from conflict_before$$,
  'all conflict paths leave registration, guardian, token, audit, digest, and version unchanged'
);

-- The transaction-scoped tryout/key lock makes concurrent callers observe one
-- of these two serial orders. Exercise both outcomes on the same durable key:
-- changed-before-exact cannot poison the upgrade, and changed-after-exact
-- cannot replay the newly upgraded row.
create temporary table conflict_then_exact as
select * from public.submit_public_registration_v2(
  'historical-digest-camp',
  (select payload from historical_payloads where name='raw'),
  'historical-raw-conflict-key-001',repeat('b',64)
);
select is((select outcome from conflict_then_exact),'replayed',
  'changed-before-exact serialization still permits the exact historical upgrade');
select is(
  (select outcome from public.submit_public_registration_v2(
    'historical-digest-camp',
    jsonb_set((select payload from historical_payloads where name='raw'),'{responses,note}','"changed again"'),
    'historical-raw-conflict-key-001',repeat('c',64)
  )),'idempotency_conflict',
  'changed-after-exact serialization conflicts against the upgraded v2 digest'
);
select is(
  (select count(*) from public.tryout_registrations
    where submission_key_digest=encode(extensions.digest(
      'historical-raw-conflict-key-001','sha256'),'hex')),1::bigint,
  'both serialized exact/changed orders retain one registration'
);
select is(
  (select count(*) from public.registration_confirmation_tokens
    where registration_id='55151515-5151-4151-8151-515151515151'
      and used_at is null and revoked_at is null),1::bigint,
  'both serialized exact/changed orders retain one active token'
);

-- Migration 025 and the position wrapper shipped in 049 hashed the normalized
-- position-less submission. Because version 1 has no era provenance, that
-- digest is indistinguishable from a pre-025 submission that arrived already
-- normalized. Byte-different normalization-equivalent retries therefore fail
-- closed; exact stored digest bytes can still upgrade safely.
select pg_temp.insert_historical_registration(
  '85151515-5151-4151-8151-515151515151',
  '95151515-5151-4151-8151-515151515151',
  'a6151515-5151-4151-8151-515151515151',
  'historical-normalized-position-key',
  (select payload from historical_payloads where name='normalized'),
  (select payload from historical_payloads where name='normalized'),
  'd5151515-5151-4151-8151-515151515151'
);
create temporary table normalized_upgrade as
select * from public.submit_public_registration_v2(
  'historical-digest-camp',
  (select payload||jsonb_build_object('positionId','d5151515-5151-4151-8151-515151515151')
    from historical_payloads where name='raw'),
  'historical-normalized-position-key',repeat('7',64)
);
select is((select outcome from normalized_upgrade),'idempotency_conflict',
  'a normalization-equivalent v1 digest fails closed without era provenance');
select is(
  (select submission_digest_version from public.tryout_registrations
    where id='85151515-5151-4151-8151-515151515151'),1::smallint,
  'the ambiguous normalized candidate cannot rewrite digest metadata'
);
select is(
  (select position_id from public.tryout_registrations
    where id='85151515-5151-4151-8151-515151515151'),
  'd5151515-5151-4151-8151-515151515151'::uuid,
  'historical upgrade preserves the exact assigned position'
);
create temporary table normalized_exact_upgrade as
select * from public.submit_public_registration_v2(
  'historical-digest-camp',
  (select payload||jsonb_build_object('positionId','d5151515-5151-4151-8151-515151515151')
    from historical_payloads where name='normalized'),
  'historical-normalized-position-key',repeat('8',64)
);
select is((select outcome from normalized_exact_upgrade),'replayed',
  'the exact normalized historical digest bytes upgrade safely');
select is(
  (select submission_digest_version from public.tryout_registrations
    where id='85151515-5151-4151-8151-515151515151'),2::smallint,
  'the exact historical candidate upgrades exactly once'
);
select is(
  (select outcome from public.submit_public_registration_v2(
    'historical-digest-camp',
    (select payload||jsonb_build_object('positionId','d5151515-5151-4151-8151-515151515151')
      from historical_payloads where name='raw'),
    'historical-normalized-position-key',repeat('9',64)
  )),'replayed','v2 normalization semantics apply after the exact one-time upgrade'
);
select is(
  (select count(*) from public.tryout_registrations
    where id='85151515-5151-4151-8151-515151515151'),1::bigint,
  'upgrade and repeat replay retain exactly one registration'
);
select is(
  (select count(*) from public.registration_confirmation_tokens
    where registration_id='85151515-5151-4151-8151-515151515151'
      and used_at is null and revoked_at is null),1::bigint,
  'upgrade and repeat replay retain exactly one active token'
);

select * from finish();
rollback;
