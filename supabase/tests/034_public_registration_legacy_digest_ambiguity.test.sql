begin;
select no_plan();

select has_function(
  'private','normalize_public_registration_submission_v1_025',
  array['text','jsonb'],
  'the shipped 025/049 digest normalizer is modeled separately from v2'
);

insert into public.organizations(id,name,slug,timezone) values(
  'a5252525-5252-4252-8252-525252525252','Legacy Ambiguity Club',
  'legacy-ambiguity-club','America/Edmonton'
);
insert into public.tryouts(
  id,organization_id,name,slug,sport,timezone,
  registration_starts_at,registration_ends_at
) values(
  'b5252525-5252-4252-8252-525252525252',
  'a5252525-5252-4252-8252-525252525252',
  'Legacy Ambiguity Camp','legacy-ambiguity-camp','Hockey','America/Edmonton',
  clock_timestamp()-interval '1 hour',clock_timestamp()+interval '1 day'
);
insert into public.tryout_divisions(id,organization_id,tryout_id,name,sort_order) values(
  'c5252525-5252-4252-8252-525252525252',
  'a5252525-5252-4252-8252-525252525252',
  'b5252525-5252-4252-8252-525252525252','U13',0
);
insert into public.tryout_positions(id,organization_id,tryout_id,name,sort_order) values(
  'd5252525-5252-4252-8252-525252525252',
  'a5252525-5252-4252-8252-525252525252',
  'b5252525-5252-4252-8252-525252525252','Goalie',0
);
insert into public.registration_forms(id,organization_id,tryout_id,name) values(
  'f5252525-5252-4252-8252-525252525252',
  'a5252525-5252-4252-8252-525252525252',
  'b5252525-5252-4252-8252-525252525252','Public'
);
insert into public.registration_form_versions(
  id,organization_id,tryout_id,registration_form_id,version_number,
  schema,status,published_at
) values(
  '15252525-5252-4252-8252-525252525252',
  'a5252525-5252-4252-8252-525252525252',
  'b5252525-5252-4252-8252-525252525252',
  'f5252525-5252-4252-8252-525252525252',1,
  '{"fields":[
    {"key":"consent","label":"Consent","kind":"consent","required":true,"sortOrder":0},
    {"key":"note","label":"Note","kind":"text","required":false,"sortOrder":1}
  ]}',
  'published',clock_timestamp()
);
insert into public.tryout_registration_form_selections(
  organization_id,tryout_id,registration_form_version_id
) values(
  'a5252525-5252-4252-8252-525252525252',
  'b5252525-5252-4252-8252-525252525252',
  '15252525-5252-4252-8252-525252525252'
);
update public.tryouts set status='published',published_at=clock_timestamp()
where id='b5252525-5252-4252-8252-525252525252';

create function pg_temp.insert_legacy_row(
  p_registration_id uuid,
  p_athlete_id uuid,
  p_guardian_id uuid,
  p_key text,
  p_stored_payload jsonb,
  p_digest_payload jsonb,
  p_position_id uuid default null
) returns void language plpgsql as $$
begin
  insert into public.athletes(
    id,organization_id,given_name,family_name,
    normalized_given_name,normalized_family_name,birth_date
  ) values(
    p_athlete_id,'a5252525-5252-4252-8252-525252525252',
    p_stored_payload->>'givenName',p_stored_payload->>'familyName',
    lower(p_stored_payload->>'givenName'),lower(p_stored_payload->>'familyName'),
    (p_stored_payload->>'birthDate')::date
  );
  insert into public.guardians(
    id,organization_id,name,email,normalized_email,phone
  ) values(
    p_guardian_id,'a5252525-5252-4252-8252-525252525252',
    p_stored_payload->>'guardianName',p_stored_payload->>'guardianEmail',
    lower(p_stored_payload->>'guardianEmail'),p_stored_payload->>'guardianPhone'
  );
  insert into public.athlete_guardians(organization_id,athlete_id,guardian_id)
  values('a5252525-5252-4252-8252-525252525252',p_athlete_id,p_guardian_id);
  insert into public.tryout_registrations(
    id,organization_id,tryout_id,athlete_id,division_id,position_id,
    registration_form_version_id,responses,submission_key_digest,
    submission_digest,submission_digest_version
  ) values(
    p_registration_id,'a5252525-5252-4252-8252-525252525252',
    'b5252525-5252-4252-8252-525252525252',p_athlete_id,
    'c5252525-5252-4252-8252-525252525252',p_position_id,
    '15252525-5252-4252-8252-525252525252',p_stored_payload->'responses',
    encode(extensions.digest(p_key,'sha256'),'hex'),
    encode(extensions.digest(p_digest_payload::text,'sha256'),'hex'),1
  );
  insert into public.registration_confirmation_tokens(
    organization_id,registration_id,token_digest,expires_at
  ) values(
    'a5252525-5252-4252-8252-525252525252',p_registration_id,
    encode(extensions.digest(p_registration_id::text,'sha256'),'hex'),
    clock_timestamp()+interval '7 days'
  );
end;
$$;

create temporary table legacy_payloads(name text primary key,payload jsonb);
insert into legacy_payloads values
('normalized',jsonb_build_object(
  'givenName','Ava','familyName','Smith','birthDate','2013-05-01',
  'guardianName','Taylor Smith','guardianEmail','guardian@example.com',
  'guardianPhone','+1 (403) 555-0100',
  'divisionId','c5252525-5252-4252-8252-525252525252',
  'responses',jsonb_build_object('consent',true,'note','fast skater')
)),
('whitespace',jsonb_build_object(
  'givenName','  Ava  ','familyName',' Smith ','birthDate','2013-05-01',
  'guardianName',' Taylor  Smith ','guardianEmail',' guardian@example.com ',
  'guardianPhone',' +1 (403) 555-0100 ',
  'divisionId','c5252525-5252-4252-8252-525252525252',
  'responses',jsonb_build_object('consent',true,'note',' fast   skater ')
));

-- A normalized pre-025 request and a 025/049 request have the same durable v1
-- digest. There is no era column, so accepting the broad normalized candidate
-- would let a byte-different retry mutate the row and rotate its token.
select pg_temp.insert_legacy_row(
  '25252525-5252-4252-8252-525252525252',
  '35252525-5252-4252-8252-525252525252',
  '45252525-5252-4252-8252-525252525252',
  'ambiguous-normalized-pre025-key',
  (select payload from legacy_payloads where name='normalized'),
  (select payload from legacy_payloads where name='normalized'),null
);
create temporary table ambiguous_before as select
  (select submission_digest from public.tryout_registrations
    where id='25252525-5252-4252-8252-525252525252') digest,
  (select submission_digest_version from public.tryout_registrations
    where id='25252525-5252-4252-8252-525252525252') digest_version,
  (select count(*) from public.registration_confirmation_tokens
    where registration_id='25252525-5252-4252-8252-525252525252') tokens,
  (select count(*) from public.registration_confirmation_tokens
    where registration_id='25252525-5252-4252-8252-525252525252'
      and revoked_at is null and used_at is null) active_tokens,
  (select count(*) from public.audit_logs) audits;
select is(
  (select outcome from public.submit_public_registration_v2(
    'legacy-ambiguity-camp',
    (select payload from legacy_payloads where name='whitespace'),
    'ambiguous-normalized-pre025-key',repeat('1',64)
  )),'idempotency_conflict',
  'a byte-different normalized candidate conflicts when its v1 era is unknowable'
);
select results_eq(
  $$select registration.submission_digest,registration.submission_digest_version,
      (select count(*) from public.registration_confirmation_tokens token
        where token.registration_id=registration.id),
      (select count(*) from public.registration_confirmation_tokens token
        where token.registration_id=registration.id
          and token.revoked_at is null and token.used_at is null),
      (select count(*) from public.audit_logs)
    from public.tryout_registrations registration
    where registration.id='25252525-5252-4252-8252-525252525252'$$,
  $$select digest,digest_version,tokens,active_tokens,audits from ambiguous_before$$,
  'an ambiguous conflict is byte- and side-effect-free'
);
select is(
  (select outcome from public.submit_public_registration_v2(
    'legacy-ambiguity-camp',
    (select payload from legacy_payloads where name='normalized'),
    'ambiguous-normalized-pre025-key',repeat('2',64)
  )),'replayed','the exact normalized historical bytes still replay'
);

-- Migration 025/049 canonicalized only identity/contact and dynamic textual
-- response values. It validated UUIDs later in the base transaction and kept
-- submitted UUID string spelling in the position-less digest.
create temporary table uppercase_payloads(name text primary key,payload jsonb);
insert into uppercase_payloads values
('normalized',jsonb_build_object(
  'givenName','Upper Ava','familyName','Smith','birthDate','2013-05-01',
  'guardianName','Taylor Smith','guardianEmail','upper@example.com',
  'guardianPhone','+1 (403) 555-0101',
  'divisionId','C5252525-5252-4252-8252-525252525252',
  'responses',jsonb_build_object('consent',true,'note','quick hands')
)),
('whitespace',jsonb_build_object(
  'givenName',' Upper  Ava ','familyName',' Smith ','birthDate','2013-05-01',
  'guardianName',' Taylor Smith ','guardianEmail',' upper@example.com ',
  'guardianPhone',' +1 (403) 555-0101 ',
  'divisionId','C5252525-5252-4252-8252-525252525252',
  'responses',jsonb_build_object('consent',true,'note',' quick   hands ')
));
select is(
  private.normalize_public_registration_submission_v1_025(
    'legacy-ambiguity-camp',
    (select payload||jsonb_build_object(
      'positionId','D5252525-5252-4252-8252-525252525252'
    ) from uppercase_payloads where name='whitespace')
  ),
  (select payload from uppercase_payloads where name='normalized'),
  '025/049 normalized dynamic strings but preserved submitted division UUID spelling and excluded position'
);
select function_privs_are(
  'private','normalize_public_registration_submission_v1_025',
  array['text','jsonb'],'service_role',array[]::text[],
  'the historical digest helper is not a service-callable route'
);
select pg_temp.insert_legacy_row(
  '55252525-5252-4252-8252-525252525252',
  '65252525-5252-4252-8252-525252525252',
  '75252525-5252-4252-8252-525252525252',
  'uppercase-025-exact-key-0001',
  (select payload from uppercase_payloads where name='normalized'),
  (select payload from uppercase_payloads where name='normalized'),
  'd5252525-5252-4252-8252-525252525252'
);
select is(
  (select outcome from public.submit_public_registration_v2(
    'legacy-ambiguity-camp',
    (select payload||jsonb_build_object(
      'positionId','D5252525-5252-4252-8252-525252525252'
    ) from uppercase_payloads where name='normalized'),
    'uppercase-025-exact-key-0001',repeat('3',64)
  )),'replayed','exact 025/049 bytes replay with preserved uppercase UUID spelling'
);
select is(
  (select submission_digest_version from public.tryout_registrations
    where id='55252525-5252-4252-8252-525252525252'),2::smallint,
  'an exact uppercase historical replay upgrades to canonical v2'
);

select pg_temp.insert_legacy_row(
  '85252525-5252-4252-8252-525252525252',
  '95252525-5252-4252-8252-525252525252',
  'a6252525-5252-4252-8252-525252525252',
  'uppercase-025-ambiguous-key-1',
  (select payload from uppercase_payloads where name='normalized'),
  (select payload from uppercase_payloads where name='normalized'),null
);
select is(
  (select outcome from public.submit_public_registration_v2(
    'legacy-ambiguity-camp',
    (select payload from uppercase_payloads where name='whitespace'),
    'uppercase-025-ambiguous-key-1',repeat('4',64)
  )),'idempotency_conflict',
  'uppercase 025/049 normalization-equivalent bytes fail closed without provenance'
);
select is(
  (select submission_digest_version from public.tryout_registrations
    where id='85252525-5252-4252-8252-525252525252'),1::smallint,
  'ambiguous uppercase history retains its digest version'
);

select throws_ok(
  $$select * from public.submit_public_registration_v2(
    'legacy-ambiguity-camp',
    jsonb_set((select payload from uppercase_payloads where name='normalized'),
      '{divisionId}','"C5252525-5252-4252-8252-52525252525Z"'),
    'uppercase-025-ambiguous-key-1',repeat('5',64)
  )$$,'22023',null,'preserved historical spelling does not bypass UUID validation'
);
select function_privs_are(
  'public','submit_public_registration_v2',array['text','jsonb','text','text'],
  'service_role',array['EXECUTE'],'service role retains the canonical route'
);
select function_privs_are(
  'public','submit_public_registration_with_phone',array['text','jsonb','text','text'],
  'service_role',array[]::text[],'legacy normalized wrapper remains owner-only'
);
select is(
  (select prosecdef from pg_proc routine join pg_namespace namespace
    on namespace.oid=routine.pronamespace
    where namespace.nspname='public' and routine.proname='submit_public_registration_v2'),
  true,'canonical route remains security definer'
);
select is(
  (select proconfig from pg_proc routine join pg_namespace namespace
    on namespace.oid=routine.pronamespace
    where namespace.nspname='public' and routine.proname='submit_public_registration_v2'),
  array['search_path=""']::text[],'canonical route retains an empty search path'
);

select * from finish();
rollback;
