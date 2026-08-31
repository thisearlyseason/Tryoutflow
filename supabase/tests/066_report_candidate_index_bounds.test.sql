begin;
select plan(9);

select has_index('public','tryout_registrations','tryout_registrations_report_latest_athlete_idx',
  'latest tenant-athlete registration lookup has the exact stable composite index');
select has_index('public','tryout_registrations','tryout_registrations_report_submitted_order_idx',
  'submitted report registrations are ordered by the bounded candidate key');
select has_index('public','session_enrollments','session_enrollments_report_candidate_order_idx',
  'evaluation candidate enrollment lookup has its tenant and lifecycle composite index');
select has_index('public','evaluations','evaluations_report_candidate_lifecycle_idx',
  'evaluation lifecycle lookup has its tenant candidate composite index');

insert into public.organizations(id,name,slug,timezone,terminology,sport_defaults,tag_defaults)
values('66000000-0000-4000-8000-000000000001','Report bound index','report-bound-index','America/Edmonton','{"athlete":"Player"}','["Hockey"]','[]');
insert into public.tryouts(id,organization_id,name,slug,sport,timezone)
values('66000000-0000-4000-8000-000000000002','66000000-0000-4000-8000-000000000001','Bounded','bounded','Hockey','America/Edmonton');
insert into public.athletes(id,organization_id,given_name,family_name,normalized_given_name,normalized_family_name,birth_date) values
  ('66000000-0000-4000-8000-000000000011','66000000-0000-4000-8000-000000000001','One','Synthetic','one','synthetic','2012-01-01'),
  ('66000000-0000-4000-8000-000000000012','66000000-0000-4000-8000-000000000001','Two','Synthetic','two','synthetic','2012-01-02'),
  ('66000000-0000-4000-8000-000000000013','66000000-0000-4000-8000-000000000001','Three','Synthetic','three','synthetic','2012-01-03');

select is(
  (select count(*)::integer from private.bounded_report_athlete_candidates('66000000-0000-4000-8000-000000000001',null,2)),
  3,'organization athlete candidate scan materializes exactly maxRows plus one before the latest-registration lookup'
);
select is(
  (select array_agg(athlete_id order by athlete_id) from private.bounded_report_athlete_candidates('66000000-0000-4000-8000-000000000001',null,2)),
  array['66000000-0000-4000-8000-000000000011'::uuid,'66000000-0000-4000-8000-000000000012'::uuid,'66000000-0000-4000-8000-000000000013'::uuid],
  'candidate tenant order is stable'
);

select lives_ok($$explain (analyze false, costs false, summary false)
  select * from private.bounded_report_athlete_candidates('66000000-0000-4000-8000-000000000001',null,2)$$,
  'EXPLAIN accepts the bounded latest-registration candidate plan');
select lives_ok($$explain (analyze false, costs false, summary false)
  select * from private.bounded_report_evaluation_candidates('66000000-0000-4000-8000-000000000001','66000000-0000-4000-8000-000000000002',2)$$,
  'EXPLAIN accepts the bounded evaluation lifecycle candidate plan');
select is((select proconfig from pg_proc where oid=to_regprocedure('private.bounded_report_evaluation_candidates(uuid,uuid,integer)')),
  array['search_path=""']::text[],'bounded evaluation helper keeps an empty search path');

select * from finish();
rollback;
