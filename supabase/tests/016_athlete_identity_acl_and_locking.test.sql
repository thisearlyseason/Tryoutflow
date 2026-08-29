begin;
select no_plan();

create temporary table expected_sensitive_table_privileges(
  table_name text not null,
  role_name text not null,
  privileges text[] not null,
  primary key(table_name,role_name)
);

insert into expected_sensitive_table_privileges(table_name,role_name,privileges)
select table_name,role_name,
  case
    when role_name='authenticated' and table_name in (
      'athletes','guardians','athlete_guardians','tryout_registrations',
      'session_enrollments','registration_duplicate_candidates','athlete_import_previews'
    ) then array['SELECT']::text[]
    else array[]::text[]
  end
from unnest(array[
  'athletes','guardians','athlete_guardians','tryout_registrations',
  'session_enrollments','registration_duplicate_candidates',
  'registration_confirmation_tokens','registration_rate_counters',
  'athlete_import_previews'
]) table_name
cross join unnest(array['PUBLIC','anon','authenticated','service_role']) role_name;

select is(
  coalesce((
    select array_agg(acl.privilege_type order by acl.privilege_type)
    from pg_class relation
    cross join lateral aclexplode(coalesce(relation.relacl,acldefault('r',relation.relowner))) acl
    left join pg_roles grantee on grantee.oid=acl.grantee
    where relation.oid=('public.'||expected.table_name)::regclass
      and case when expected.role_name='PUBLIC' then acl.grantee=0 else grantee.rolname=expected.role_name end
  ),array[]::text[]),
  expected.privileges,
  expected.role_name||' has only the intended privileges on '||expected.table_name
)
from expected_sensitive_table_privileges expected
order by expected.table_name,expected.role_name;

select has_function(
  'public','canonical_athlete_identity_lock_key',array['uuid','text','text','date'],
  'athlete identity has one structured advisory-lock key function'
);
select function_privs_are(
  'public','canonical_athlete_identity_lock_key',array['uuid','text','text','date'],
  'authenticated',array[]::text[],
  'authenticated clients cannot inspect or acquire internal identity locks'
);
select function_privs_are(
  'public','canonical_athlete_identity_lock_key',array['uuid','text','text','date'],
  'service_role',array[]::text[],
  'service role reaches identity locking only through controlled functions'
);
select trigger_is(
  'public','athletes','canonicalize_athlete_identity_fields',
  'public','canonicalize_athlete_identity_fields',
  'every athlete write derives canonical normalized names'
);

insert into public.organizations(id,name,slug,timezone)
values('a1616161-4040-4616-8616-161616161616','Identity Contract','identity-contract','America/Edmonton');

insert into public.athletes(
  id,organization_id,given_name,family_name,
  normalized_given_name,normalized_family_name,birth_date
) values (
  'b1616161-4040-4616-8616-161616161616',
  'a1616161-4040-4616-8616-161616161616',
  U&'  JOSE\0301\00a0 |  Ana  ',U&'Van\2003  Dyke',
  'forged-given','forged-family','2013-05-01'
);

select is(
  (select normalized_given_name from public.athletes where id='b1616161-4040-4616-8616-161616161616'),
  U&'jos\00e9 | ana',
  'direct inserts cannot forge normalized given names and use NFC/case/whitespace normalization'
);
select is(
  (select normalized_family_name from public.athletes where id='b1616161-4040-4616-8616-161616161616'),
  'van dyke',
  'direct inserts cannot forge normalized family names'
);

update public.athletes set normalized_given_name='historically-wrong',normalized_family_name='historically-wrong'
where id='b1616161-4040-4616-8616-161616161616';
select is(
  (select normalized_given_name||':'||normalized_family_name from public.athletes where id='b1616161-4040-4616-8616-161616161616'),
  U&'jos\00e9 | ana:van dyke',
  'updates repair stale or forged normalized columns from the actual names'
);

select is(
  public.current_athlete_import_candidate_ids(
    'a1616161-4040-4616-8616-161616161616',
    U&'[{
      "row":2,"status":"valid","errors":[],
      "athlete":{"givenName":"jos\00e9 | ana","familyName":"van dyke","birthDate":"2013-05-01"},
      "duplicateCandidateIds":[]
    }]'::jsonb,
    2
  ),
  '["b1616161-4040-4616-8616-161616161616"]'::jsonb,
  'SQL candidate lookup trusts only database-derived canonical normalized names'
);

alter table public.athletes disable trigger canonicalize_athlete_identity_fields;
select throws_ok(
  $$insert into public.athletes(
      organization_id,given_name,family_name,normalized_given_name,normalized_family_name,birth_date
    ) values (
      'a1616161-4040-4616-8616-161616161616','Direct','Lie','wrong','wrong','2014-01-01'
    )$$,
  '23514',null,
  'the canonical equality constraint rejects divergence even if trigger execution is bypassed'
);
alter table public.athletes enable trigger canonicalize_athlete_identity_fields;

select isnt(
  public.canonical_athlete_identity_lock_key(
    'a1616161-4040-4616-8616-161616161616','Ada|Beth','Chen','2012-01-01'
  ),
  public.canonical_athlete_identity_lock_key(
    'a1616161-4040-4616-8616-161616161616','Ada','Beth|Chen','2012-01-01'
  ),
  'field delimiters cannot alias two structured athlete identities'
);
select is(
  public.canonical_athlete_identity_lock_key(
    'a1616161-4040-4616-8616-161616161616',U&' JOSE\0301\00a0','SMITH','2013-05-01'
  ),
  public.canonical_athlete_identity_lock_key(
    'a1616161-4040-4616-8616-161616161616',U&'jos\00e9','smith','2013-05-01'
  ),
  'equivalent NFC/case/whitespace identities share one lock key'
);

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select throws_ok(
  $$insert into public.athletes(
      organization_id,given_name,family_name,normalized_given_name,normalized_family_name,birth_date
    ) values
      ('a1616161-4040-4616-8616-161616161616','One','Athlete','one','athlete','2012-01-01'),
      ('a1616161-4040-4616-8616-161616161616','Two','Athlete','two','athlete','2012-01-01')$$,
  '42501',null,
  'authenticated clients cannot bypass ordered RPC locking with a direct multi-row insert'
);

select throws_ok(
  format('truncate table public.%I cascade',target.table_name),
  '42501',null,
  'authenticated cannot truncate '||target.table_name
)
from unnest(array[
  'athletes','guardians','athlete_guardians','tryout_registrations',
  'session_enrollments','registration_duplicate_candidates',
  'registration_confirmation_tokens','registration_rate_counters',
  'athlete_import_previews'
]) target(table_name)
order by target.table_name;

reset role;
select * from finish();
rollback;
