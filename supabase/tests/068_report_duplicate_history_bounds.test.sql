begin;
select no_plan();

select has_table('private','report_tryout_athlete_population',
  'tryout reports have a naturally unique private athlete population relation');
select col_is_pk('private','report_tryout_athlete_population',
  array['organization_id','tryout_id','athlete_id'],
  'the report population is naturally unique by tenant, tryout, and athlete');
select has_fk('private','report_tryout_athlete_population',
  'the report population has tenant-safe parent foreign keys');
select is((select count(*) from pg_constraint
  where conrelid='private.report_tryout_athlete_population'::regclass
    and contype='f' and confdeltype='c'),2::bigint,
  'both population parent foreign keys cascade with their tenant parents');
select is((select relrowsecurity from pg_class
  where oid='private.report_tryout_athlete_population'::regclass),true,
  'the private population retains defense-in-depth RLS');
select table_privs_are('private','report_tryout_athlete_population','authenticated',array[]::text[],
  'authenticated clients have no direct population privileges');
select table_privs_are('private','report_tryout_athlete_population','anon',array[]::text[],
  'anonymous clients have no direct population privileges');
select table_privs_are('private','report_tryout_athlete_population','service_role',array[]::text[],
  'service role has no direct population privileges');
select function_privs_are('private','rebuild_report_tryout_athlete_population',array[]::text[],
  'authenticated',array[]::text[],'authenticated clients cannot rebuild report membership');
select is((select count(*) from pg_proc
  where oid in (
    'private.rebuild_report_tryout_athlete_population()'::regprocedure,
    'private.maintain_report_tryout_athlete_population()'::regprocedure,
    'private.prevent_registration_identity_mutation()'::regprocedure,
    'private.bounded_report_athlete_candidates(uuid,uuid,integer)'::regprocedure
  ) and prosecdef and proconfig=array['search_path=""']::text[]),4::bigint,
  'all population boundaries are security definer with an empty search path');
select trigger_is('public','tryout_registrations',
  'maintain_report_tryout_athlete_population_insert_delete','private',
  'maintain_report_tryout_athlete_population',
  'registration inserts and deletes maintain report membership');
select trigger_is('public','tryout_registrations',
  'maintain_report_tryout_athlete_population_truncate','private',
  'maintain_report_tryout_athlete_population',
  'registration truncation has an explicit population maintenance path');
select trigger_is('public','tryout_registrations',
  'prevent_registration_identity_mutation','private',
  'prevent_registration_identity_mutation',
  'registration report identity cannot move between natural keys');
select is((select count(*) from pg_trigger
  where tgrelid='public.tryout_registrations'::regclass
    and tgname in (
      'maintain_report_tryout_athlete_population_insert_delete',
      'maintain_report_tryout_athlete_population_truncate',
      'prevent_registration_identity_mutation'
    ) and tgenabled='A'),3::bigint,
  'population and identity triggers remain active during replica-role writes');

insert into public.organizations(id,name,slug,timezone,terminology,sport_defaults,tag_defaults)
values('68000000-0000-4000-8000-000000000001','Duplicate history bounds','duplicate-history-bounds','America/Edmonton','{"athlete":"Player"}','["Hockey"]','[]');
insert into public.tryouts(id,organization_id,name,slug,sport,timezone) values
  ('68000000-0000-4000-8000-000000000011','68000000-0000-4000-8000-000000000001','Primary','duplicate-history-primary','Hockey','America/Edmonton'),
  ('68000000-0000-4000-8000-000000000012','68000000-0000-4000-8000-000000000001','Secondary','duplicate-history-secondary','Hockey','America/Edmonton');
insert into public.tryout_divisions(id,organization_id,tryout_id,name,sort_order) values
  ('68000000-0000-4000-8000-000000000021','68000000-0000-4000-8000-000000000001','68000000-0000-4000-8000-000000000011','U15',0),
  ('68000000-0000-4000-8000-000000000022','68000000-0000-4000-8000-000000000001','68000000-0000-4000-8000-000000000012','U16',0);
insert into public.registration_forms(id,organization_id,tryout_id,name) values
  ('68000000-0000-4000-8000-000000000031','68000000-0000-4000-8000-000000000001','68000000-0000-4000-8000-000000000011','Primary Form'),
  ('68000000-0000-4000-8000-000000000032','68000000-0000-4000-8000-000000000001','68000000-0000-4000-8000-000000000012','Secondary Form');
insert into public.registration_form_versions(
  id,organization_id,tryout_id,registration_form_id,version_number,schema,status,published_at
) values
(
  '68000000-0000-4000-8000-000000000041','68000000-0000-4000-8000-000000000001',
  '68000000-0000-4000-8000-000000000011','68000000-0000-4000-8000-000000000031',
  1,'{"fields":[]}','published','2026-01-01 00:00:00+00'
),(
  '68000000-0000-4000-8000-000000000042','68000000-0000-4000-8000-000000000001',
  '68000000-0000-4000-8000-000000000012','68000000-0000-4000-8000-000000000032',
  1,'{"fields":[]}','draft',null
);
insert into public.athletes(
  id,organization_id,given_name,family_name,normalized_given_name,normalized_family_name,birth_date
) values
  ('68000000-0000-4000-8000-000000000101','68000000-0000-4000-8000-000000000001','Duplicate','History','duplicate','history','2012-01-01'),
  ('68000000-0000-4000-8000-000000000102','68000000-0000-4000-8000-000000000001','Second','Athlete','second','athlete','2012-01-02'),
  ('68000000-0000-4000-8000-000000000103','68000000-0000-4000-8000-000000000001','Third','Athlete','third','athlete','2012-01-03'),
  ('68000000-0000-4000-8000-000000000104','68000000-0000-4000-8000-000000000001','Never','Registered','never','registered','2012-01-04'),
  ('68000000-0000-4000-8000-000000000105','68000000-0000-4000-8000-000000000001','Historical','Backfill','historical','backfill','2012-01-05'),
  ('68000000-0000-4000-8000-000000000106','68000000-0000-4000-8000-000000000001','Replica','Maintained','replica','maintained','2012-01-06'),
  ('68000000-0000-4000-8000-000000000107','68000000-0000-4000-8000-000000000001','Cascade','Truth','cascade','truth','2012-01-07');

insert into public.tryout_registrations(
  id,organization_id,tryout_id,athlete_id,division_id,registration_form_version_id,
  responses,submission_key_digest,submission_digest,status,created_at
)
select ('68000000-0000-4000-8001-'||lpad(to_hex(item),12,'0'))::uuid,
  '68000000-0000-4000-8000-000000000001','68000000-0000-4000-8000-000000000011',
  '68000000-0000-4000-8000-000000000101','68000000-0000-4000-8000-000000000021',
  '68000000-0000-4000-8000-000000000041','{}',
  encode(extensions.digest('duplicate-key-'||item,'sha256'),'hex'),
  encode(extensions.digest('duplicate-payload-'||item,'sha256'),'hex'),
  case item%3 when 0 then 'withdrawn' when 1 then 'cancelled' else 'submitted' end,
  '2026-01-01 00:00:00+00'::timestamptz+item*interval '1 second'
from generate_series(1,12000) item;
insert into public.tryout_registrations(
  id,organization_id,tryout_id,athlete_id,division_id,registration_form_version_id,
  responses,submission_key_digest,submission_digest,created_at
) values
  ('68000000-0000-4000-8002-000000000001','68000000-0000-4000-8000-000000000001','68000000-0000-4000-8000-000000000011','68000000-0000-4000-8000-000000000102','68000000-0000-4000-8000-000000000021','68000000-0000-4000-8000-000000000041','{}',repeat('a',64),repeat('b',64),'2026-02-01 00:00:00+00'),
  ('68000000-0000-4000-8002-000000000002','68000000-0000-4000-8000-000000000001','68000000-0000-4000-8000-000000000011','68000000-0000-4000-8000-000000000103','68000000-0000-4000-8000-000000000021','68000000-0000-4000-8000-000000000041','{}',repeat('c',64),repeat('d',64),'2026-02-02 00:00:00+00');

-- Newer history in a different tryout makes an organization/athlete index a
-- measurably bad choice for the requested-tryout lateral lookup.
insert into public.tryout_registrations(
  id,organization_id,tryout_id,athlete_id,division_id,registration_form_version_id,
  responses,submission_key_digest,submission_digest,created_at
)
select ('68000000-0000-4000-8004-'||lpad(to_hex(item),12,'0'))::uuid,
  '68000000-0000-4000-8000-000000000001','68000000-0000-4000-8000-000000000012',
  '68000000-0000-4000-8000-000000000101','68000000-0000-4000-8000-000000000022',
  '68000000-0000-4000-8000-000000000042','{}',
  encode(extensions.digest('secondary-key-'||item,'sha256'),'hex'),
  encode(extensions.digest('secondary-payload-'||item,'sha256'),'hex'),
  '2027-01-01 00:00:00+00'::timestamptz+item*interval '1 second'
from generate_series(1,12000) item;

analyze public.tryout_registrations;

create function pg_temp.explain_json(query text) returns jsonb
language plpgsql volatile set search_path='' as $$
declare output jsonb;
begin
  execute 'explain (analyze,costs off,timing off,summary off,format json) '||query into output;
  return output;
end;
$$;

create function pg_temp.plan_nodes(explanation jsonb) returns table(node jsonb)
language sql immutable set search_path='' as $$
  with recursive nodes(node) as (
    select explanation->0->'Plan'
    union all
    select child.value
    from nodes parent
    cross join lateral jsonb_array_elements(coalesce(parent.node->'Plans','[]'::jsonb)) child
  )
  select nodes.node from nodes;
$$;

create temporary table old_candidate_plan as
select pg_temp.explain_json($query$
  select distinct on (registration.athlete_id)
    registration.athlete_id,registration.id
  from public.tryout_registrations registration
  where registration.organization_id='68000000-0000-4000-8000-000000000001'
    and registration.tryout_id='68000000-0000-4000-8000-000000000011'
  order by registration.athlete_id,registration.created_at desc,registration.id desc
  limit 3
$query$) explanation;

select diag('pre-086 registration leaf rows read: '||(
  select sum((node->>'Actual Rows')::numeric*(node->>'Actual Loops')::numeric)::bigint
  from old_candidate_plan, lateral pg_temp.plan_nodes(explanation)
  where node->>'Relation Name'='tryout_registrations'
));

select cmp_ok((
  select sum((node->>'Actual Rows')::numeric*(node->>'Actual Loops')::numeric)::bigint
  from old_candidate_plan, lateral pg_temp.plan_nodes(explanation)
  where node->>'Relation Name'='tryout_registrations'
),'>',12000::bigint,
  'the pre-086 DISTINCT ON plan demonstrably reads all 12,000 duplicate-history rows');

select is((select count(*) from private.report_tryout_athlete_population
  where organization_id='68000000-0000-4000-8000-000000000001'
    and tryout_id='68000000-0000-4000-8000-000000000011'),3::bigint,
  '12,002 registrations materialize exactly three tryout athlete memberships');
select is((select registration_count from private.report_tryout_athlete_population
  where organization_id='68000000-0000-4000-8000-000000000001'
    and tryout_id='68000000-0000-4000-8000-000000000011'
    and athlete_id='68000000-0000-4000-8000-000000000101'),12000::bigint,
  'withdrawn, cancelled, and submitted history all remain in the population witness');

select is((select array_agg(registration_id order by athlete_id)
  from private.bounded_report_athlete_candidates(
    '68000000-0000-4000-8000-000000000001','68000000-0000-4000-8000-000000000011',2
  )),array[
    ('68000000-0000-4000-8001-'||lpad(to_hex(12000),12,'0'))::uuid,
    '68000000-0000-4000-8002-000000000001'::uuid,
    '68000000-0000-4000-8002-000000000002'::uuid
  ],'tryout candidates preserve stable maxRows plus one and latest registration truth');

set local enable_seqscan=off;
create temporary table bounded_candidate_plan as
select pg_temp.explain_json($query$
  select population.athlete_id,latest.id registration_id
  from (
    select membership.athlete_id
    from private.report_tryout_athlete_population membership
    where membership.organization_id='68000000-0000-4000-8000-000000000001'
      and membership.tryout_id='68000000-0000-4000-8000-000000000011'
      and membership.registration_count>0
    order by membership.athlete_id
    limit 3
  ) population
  join lateral (
    select registration.id
    from public.tryout_registrations registration
    where registration.organization_id='68000000-0000-4000-8000-000000000001'
      and registration.tryout_id='68000000-0000-4000-8000-000000000011'
      and registration.athlete_id=population.athlete_id
    order by registration.created_at desc,registration.id desc
    limit 1
  ) latest on true
  order by population.athlete_id
$query$) explanation;

select diag('post-086 population leaf rows read: '||(
  select sum((node->>'Actual Rows')::numeric*(node->>'Actual Loops')::numeric)::bigint
  from bounded_candidate_plan, lateral pg_temp.plan_nodes(explanation)
  where node->>'Relation Name'='report_tryout_athlete_population'
)||'; registration leaf rows read: '||(
  select sum((node->>'Actual Rows')::numeric*(node->>'Actual Loops')::numeric)::bigint
  from bounded_candidate_plan, lateral pg_temp.plan_nodes(explanation)
  where node->>'Relation Name'='tryout_registrations'
));
select ok(not exists(select 1 from bounded_candidate_plan,
  lateral pg_temp.plan_nodes(explanation) where node->>'Node Type'='Sort'),
  'bounded candidate work performs no Sort');
select ok(not exists(select 1 from bounded_candidate_plan,
  lateral pg_temp.plan_nodes(explanation) where node->>'Node Type'='Seq Scan'),
  'bounded candidate work performs no Seq Scan');
select cmp_ok((select sum((node->>'Actual Rows')::numeric*(node->>'Actual Loops')::numeric)::bigint
  from bounded_candidate_plan, lateral pg_temp.plan_nodes(explanation)
  where node->>'Relation Name'='report_tryout_athlete_population'),'<=',3::bigint,
  'the composite population primary key reads at most maxRows plus one candidates');
select cmp_ok((select sum((node->>'Actual Rows')::numeric*(node->>'Actual Loops')::numeric)::bigint
  from bounded_candidate_plan, lateral pg_temp.plan_nodes(explanation)
  where node->>'Relation Name'='tryout_registrations'),'<=',3::bigint,
  'latest-registration lateral probes read at most one row per bounded candidate');
select diag('post-086 indexes: '||(select string_agg(distinct node->>'Index Name',', ')
  from bounded_candidate_plan, lateral pg_temp.plan_nodes(explanation)
  where node ? 'Index Name'));
select ok((select array_agg(distinct node->>'Index Name')
  from bounded_candidate_plan, lateral pg_temp.plan_nodes(explanation)
  where node ? 'Index Name') @> array[
    'report_tryout_athlete_population_pkey',
    'tryout_registrations_report_tryout_athlete_latest_idx'
  ],'the actual bounded plan uses both exact composite indexes');

select is((select count(*)::integer from private.bounded_report_athlete_candidates(
  '68000000-0000-4000-8000-000000000001','68000000-0000-4000-8000-000000000011',1
)),2,'the tryout candidate boundary is exactly maxRows plus one');

insert into public.tryout_registrations(
  id,organization_id,tryout_id,athlete_id,division_id,registration_form_version_id,
  responses,submission_key_digest,submission_digest,status,created_at
) values
  ('68000000-0000-4000-8003-000000000001','68000000-0000-4000-8000-000000000001','68000000-0000-4000-8000-000000000011','68000000-0000-4000-8000-000000000101','68000000-0000-4000-8000-000000000021','68000000-0000-4000-8000-000000000041','{}',repeat('e',64),repeat('f',64),'submitted','2025-12-01 00:00:00+00'),
  ('68000000-0000-4000-8003-000000000002','68000000-0000-4000-8000-000000000001','68000000-0000-4000-8000-000000000011','68000000-0000-4000-8000-000000000101','68000000-0000-4000-8000-000000000021','68000000-0000-4000-8000-000000000041','{}',repeat('1e',32),repeat('1f',32),'cancelled','2026-01-01 03:20:00+00');
select is((select registration_count from private.report_tryout_athlete_population
  where organization_id='68000000-0000-4000-8000-000000000001'
    and tryout_id='68000000-0000-4000-8000-000000000011'
    and athlete_id='68000000-0000-4000-8000-000000000101'),12002::bigint,
  'multiple new registrations upsert one natural membership without duplication');
select is((select registration_id from private.bounded_report_athlete_candidates(
  '68000000-0000-4000-8000-000000000001','68000000-0000-4000-8000-000000000011',1
) where athlete_id='68000000-0000-4000-8000-000000000101'),
  '68000000-0000-4000-8003-000000000002'::uuid,
  'created-at ties choose the stable descending registration ID');

delete from public.tryout_registrations
where id='68000000-0000-4000-8003-000000000002';
select is((select registration_count from private.report_tryout_athlete_population
  where organization_id='68000000-0000-4000-8000-000000000001'
    and tryout_id='68000000-0000-4000-8000-000000000011'
    and athlete_id='68000000-0000-4000-8000-000000000101'),12001::bigint,
  'deleting one duplicate decrements but does not erase membership');
select is((select registration_id from private.bounded_report_athlete_candidates(
  '68000000-0000-4000-8000-000000000001','68000000-0000-4000-8000-000000000011',1
) where athlete_id='68000000-0000-4000-8000-000000000101'),
  ('68000000-0000-4000-8001-'||lpad(to_hex(12000),12,'0'))::uuid,
  'latest registration truth falls back after deleting the former latest row');

update public.tryout_registrations set status='cancelled'
where id=('68000000-0000-4000-8001-'||lpad(to_hex(12000),12,'0'))::uuid;
select is((select registration.status
  from private.bounded_report_athlete_candidates(
    '68000000-0000-4000-8000-000000000001','68000000-0000-4000-8000-000000000011',1
  ) candidate
  join public.tryout_registrations registration on registration.id=candidate.registration_id
  where candidate.athlete_id='68000000-0000-4000-8000-000000000101'),
  'cancelled','mutable latest registration status remains live report truth');
select throws_ok($sql$
  update public.tryout_registrations
  set athlete_id='68000000-0000-4000-8000-000000000102'
  where id='68000000-0000-4000-8003-000000000001'
$sql$,'55000','registration organization, tryout, and athlete are immutable',
  'registration report identity cannot move to another population key');

-- Simulate history that predates 086 by bypassing only the new membership
-- trigger.  The same locked rebuild used by the migration must recover it.
alter table public.tryout_registrations
  disable trigger maintain_report_tryout_athlete_population_insert_delete;
insert into public.tryout_registrations(
  id,organization_id,tryout_id,athlete_id,division_id,registration_form_version_id,
  responses,submission_key_digest,submission_digest,status,created_at
) values(
  '68000000-0000-4000-8005-000000000001','68000000-0000-4000-8000-000000000001',
  '68000000-0000-4000-8000-000000000011','68000000-0000-4000-8000-000000000105',
  '68000000-0000-4000-8000-000000000021','68000000-0000-4000-8000-000000000041',
  '{}',repeat('5a',32),repeat('5b',32),'withdrawn','2026-03-01 00:00:00+00'
);
alter table public.tryout_registrations
  enable always trigger maintain_report_tryout_athlete_population_insert_delete;
select is((select count(*) from private.report_tryout_athlete_population
  where organization_id='68000000-0000-4000-8000-000000000001'
    and tryout_id='68000000-0000-4000-8000-000000000011'
    and athlete_id='68000000-0000-4000-8000-000000000105'),0::bigint,
  'the pre-migration fixture starts without derived membership');
select lives_ok($$select private.rebuild_report_tryout_athlete_population()$$,
  'the migration rebuild backfills existing registration history');
select is((select registration_count from private.report_tryout_athlete_population
  where organization_id='68000000-0000-4000-8000-000000000001'
    and tryout_id='68000000-0000-4000-8000-000000000011'
    and athlete_id='68000000-0000-4000-8000-000000000105'),1::bigint,
  'backfill restores the exact withdrawn-registration witness');
select lives_ok($$select private.rebuild_report_tryout_athlete_population()$$,
  'replaying the population rebuild is idempotent');
select is((select registration_count from private.report_tryout_athlete_population
  where organization_id='68000000-0000-4000-8000-000000000001'
    and tryout_id='68000000-0000-4000-8000-000000000011'
    and athlete_id='68000000-0000-4000-8000-000000000101'),12001::bigint,
  'replay recounts rather than incrementing already materialized history');

select is((select registration_count from private.report_tryout_athlete_population
  where organization_id='68000000-0000-4000-8000-000000000001'
    and tryout_id='68000000-0000-4000-8000-000000000012'
    and athlete_id='68000000-0000-4000-8000-000000000101'),12000::bigint,
  'the same athlete has an independent population witness in another tryout');
select is((select registration_id from private.bounded_report_athlete_candidates(
  '68000000-0000-4000-8000-000000000001','68000000-0000-4000-8000-000000000012',1
)),('68000000-0000-4000-8004-'||lpad(to_hex(12000),12,'0'))::uuid,
  'multi-tryout latest registration lookup stays inside the requested tryout');

-- A separate draft tryout proves both registration-trigger maintenance and
-- parent cascades converge on the same truthful empty result.
insert into public.tryouts(id,organization_id,name,slug,sport,timezone) values
  ('68000000-0000-4000-8000-000000000013','68000000-0000-4000-8000-000000000001','Cascade','duplicate-history-cascade','Hockey','America/Edmonton');
insert into public.tryout_divisions(id,organization_id,tryout_id,name,sort_order) values
  ('68000000-0000-4000-8000-000000000023','68000000-0000-4000-8000-000000000001','68000000-0000-4000-8000-000000000013','U17',0);
insert into public.registration_forms(id,organization_id,tryout_id,name) values
  ('68000000-0000-4000-8000-000000000033','68000000-0000-4000-8000-000000000001','68000000-0000-4000-8000-000000000013','Cascade Form');
insert into public.registration_form_versions(
  id,organization_id,tryout_id,registration_form_id,version_number,schema,status
) values(
  '68000000-0000-4000-8000-000000000043','68000000-0000-4000-8000-000000000001',
  '68000000-0000-4000-8000-000000000013','68000000-0000-4000-8000-000000000033',
  1,'{"fields":[]}','draft'
);
insert into public.tryout_registrations(
  id,organization_id,tryout_id,athlete_id,division_id,registration_form_version_id,
  responses,submission_key_digest,submission_digest
) values(
  '68000000-0000-4000-8006-000000000001','68000000-0000-4000-8000-000000000001',
  '68000000-0000-4000-8000-000000000013','68000000-0000-4000-8000-000000000107',
  '68000000-0000-4000-8000-000000000023','68000000-0000-4000-8000-000000000043',
  '{}',repeat('6a',32),repeat('6b',32)
);
delete from public.tryout_registrations
where id='68000000-0000-4000-8006-000000000001';
select is((select count(*) from private.report_tryout_athlete_population
  where tryout_id='68000000-0000-4000-8000-000000000013'),0::bigint,
  'registration cascade preparation removes the truthful membership first');
delete from public.registration_form_versions
where id='68000000-0000-4000-8000-000000000043';
delete from public.registration_forms
where id='68000000-0000-4000-8000-000000000033';
delete from public.tryout_divisions
where id='68000000-0000-4000-8000-000000000023';
insert into private.report_tryout_athlete_population(
  organization_id,tryout_id,athlete_id,registration_count
) values(
  '68000000-0000-4000-8000-000000000001','68000000-0000-4000-8000-000000000013',
  '68000000-0000-4000-8000-000000000107',1
);
select lives_ok($$delete from public.tryouts
  where id='68000000-0000-4000-8000-000000000013'$$,
  'the private foreign key cascades report membership with a deleted tryout');
select is((select count(*) from private.report_tryout_athlete_population
  where tryout_id='68000000-0000-4000-8000-000000000013'),0::bigint,
  'tryout cascade leaves no private population orphan');

-- Tenant isolation is structural, not a filtering convention in callers.
insert into public.organizations(id,name,slug,timezone,terminology,sport_defaults,tag_defaults)
values('68000000-0000-4000-8000-000000000002','Other tenant','duplicate-history-other','America/Edmonton','{"athlete":"Player"}','["Hockey"]','[]');
insert into public.tryouts(id,organization_id,name,slug,sport,timezone) values
  ('68000000-0000-4000-8000-000000000211','68000000-0000-4000-8000-000000000002','Other','duplicate-history-other-tryout','Hockey','America/Edmonton');
insert into public.tryout_divisions(id,organization_id,tryout_id,name,sort_order) values
  ('68000000-0000-4000-8000-000000000221','68000000-0000-4000-8000-000000000002','68000000-0000-4000-8000-000000000211','U15',0);
insert into public.registration_forms(id,organization_id,tryout_id,name) values
  ('68000000-0000-4000-8000-000000000231','68000000-0000-4000-8000-000000000002','68000000-0000-4000-8000-000000000211','Other Form');
insert into public.registration_form_versions(
  id,organization_id,tryout_id,registration_form_id,version_number,schema,status
) values(
  '68000000-0000-4000-8000-000000000241','68000000-0000-4000-8000-000000000002',
  '68000000-0000-4000-8000-000000000211','68000000-0000-4000-8000-000000000231',
  1,'{"fields":[]}','draft'
);
insert into public.athletes(
  id,organization_id,given_name,family_name,normalized_given_name,normalized_family_name,birth_date
) values(
  '68000000-0000-4000-8000-000000000251','68000000-0000-4000-8000-000000000002',
  'Other','Tenant','other','tenant','2012-02-01'
);
insert into public.tryout_registrations(
  id,organization_id,tryout_id,athlete_id,division_id,registration_form_version_id,
  responses,submission_key_digest,submission_digest
) values(
  '68000000-0000-4000-8008-000000000001','68000000-0000-4000-8000-000000000002',
  '68000000-0000-4000-8000-000000000211','68000000-0000-4000-8000-000000000251',
  '68000000-0000-4000-8000-000000000221','68000000-0000-4000-8000-000000000241',
  '{}',repeat('8a',32),repeat('8b',32)
);
select is((select count(*) from private.bounded_report_athlete_candidates(
  '68000000-0000-4000-8000-000000000001','68000000-0000-4000-8000-000000000211',10
)),0::bigint,'a foreign tenant tryout ID cannot select report candidates');

set local session_replication_role=replica;
insert into public.tryout_registrations(
  id,organization_id,tryout_id,athlete_id,division_id,registration_form_version_id,
  responses,submission_key_digest,submission_digest,created_at
) values
  ('68000000-0000-4000-8009-000000000001','68000000-0000-4000-8000-000000000001','68000000-0000-4000-8000-000000000011','68000000-0000-4000-8000-000000000106','68000000-0000-4000-8000-000000000021','68000000-0000-4000-8000-000000000041','{}',repeat('9a',32),repeat('9b',32),'2026-04-01 00:00:00+00'),
  ('68000000-0000-4000-8009-000000000002','68000000-0000-4000-8000-000000000001','68000000-0000-4000-8000-000000000011','68000000-0000-4000-8000-000000000106','68000000-0000-4000-8000-000000000021','68000000-0000-4000-8000-000000000041','{}',repeat('9c',32),repeat('9d',32),'2026-04-02 00:00:00+00');
select is((select registration_count from private.report_tryout_athlete_population
  where organization_id='68000000-0000-4000-8000-000000000001'
    and tryout_id='68000000-0000-4000-8000-000000000011'
    and athlete_id='68000000-0000-4000-8000-000000000106'),2::bigint,
  'replica-role registration inserts still upsert exact membership');
select throws_ok($sql$
  update public.tryout_registrations
  set athlete_id='68000000-0000-4000-8000-000000000107'
  where id='68000000-0000-4000-8009-000000000001'
$sql$,'55000','registration organization, tryout, and athlete are immutable',
  'replica-role writes cannot bypass registration identity immutability');
delete from public.tryout_registrations
where id='68000000-0000-4000-8009-000000000002';
select is((select registration_count from private.report_tryout_athlete_population
  where organization_id='68000000-0000-4000-8000-000000000001'
    and tryout_id='68000000-0000-4000-8000-000000000011'
    and athlete_id='68000000-0000-4000-8000-000000000106'),1::bigint,
  'replica-role registration delete also preserves exact membership count');
set local session_replication_role=origin;

select is((select registration_id from private.bounded_report_athlete_candidates(
  '68000000-0000-4000-8000-000000000001',null,20
) where athlete_id='68000000-0000-4000-8000-000000000104'),null::uuid,
  'organization reports retain nullable latest registration for unregistered athletes');

insert into auth.users(id) values('68000000-0000-4000-8000-000000000901');
insert into public.organization_members(organization_id,user_id,role,status) values(
  '68000000-0000-4000-8000-000000000001','68000000-0000-4000-8000-000000000901','owner','active'
);
set local role authenticated;
select set_config('request.jwt.claim.sub','68000000-0000-4000-8000-000000000901',true);
select is((select (result#>>'{summary,athleteCount}')::integer
  from public.load_report_summary(
    '68000000-0000-4000-8000-000000000001','68000000-0000-4000-8000-000000000011'
  )),5,'summary count keeps every ever-registered athlete regardless of current status');
select is((select jsonb_array_length(result->'rows')
  from public.load_report_export(
    '68000000-0000-4000-8000-000000000001','athletes',
    '68000000-0000-4000-8000-000000000011',null,5
  )),5,'athlete export population matches the summary population');
select is((select item->>'registrationStatus'
  from public.load_report_export(
    '68000000-0000-4000-8000-000000000001','athletes',
    '68000000-0000-4000-8000-000000000011',null,5
  ) projection
  cross join lateral jsonb_array_elements(projection.result->'rows') item
  where item->>'preferredName'='Duplicate'),
  'cancelled','report export consumes latest mutable registration status');
select is((select item->>'registrationStatus'
  from public.load_report_export(
    '68000000-0000-4000-8000-000000000001','athletes',
    '68000000-0000-4000-8000-000000000011',null,5
  ) projection
  cross join lateral jsonb_array_elements(projection.result->'rows') item
  where item->>'preferredName'='Historical'),
  'withdrawn','withdrawn-only history remains exportable population');
select is((select result->>'truncated'
  from public.load_report_export(
    '68000000-0000-4000-8000-000000000001','athletes',
    '68000000-0000-4000-8000-000000000011',null,1
  )),'true','CSV projection preserves the maxRows overflow contract');
select throws_ok($$select count(*) from private.report_tryout_athlete_population$$,
  '42501','permission denied for schema private',
  'authenticated clients cannot bypass the report projection through the private relation');
reset role;

delete from public.tryout_registrations
where id='68000000-0000-4000-8002-000000000002';
select is((select count(*) from private.report_tryout_athlete_population
  where organization_id='68000000-0000-4000-8000-000000000001'
    and tryout_id='68000000-0000-4000-8000-000000000011'
    and athlete_id='68000000-0000-4000-8000-000000000103'),0::bigint,
  'deleting an athlete last registration removes its tryout membership');
select lives_ok($$delete from public.athletes
  where id='68000000-0000-4000-8000-000000000103'$$,
  'an athlete can be deleted after its last registration and membership are gone');

set local session_replication_role=replica;
delete from public.tryout_registrations
where id='68000000-0000-4000-8009-000000000001';
set local session_replication_role=origin;
select is((select count(*) from private.report_tryout_athlete_population
  where organization_id='68000000-0000-4000-8000-000000000001'
    and tryout_id='68000000-0000-4000-8000-000000000011'
    and athlete_id='68000000-0000-4000-8000-000000000106'),0::bigint,
  'replica-role last delete removes the membership row');
select is((select count(*) from private.report_tryout_athlete_population
  where registration_count=0),0::bigint,
  'no committed zero-count population tombstone remains');

select * from finish();
rollback;
