begin;
select plan(8);

select has_index('public','tryout_registrations','tryout_registrations_report_tryout_athlete_latest_idx',
  'tryout athlete candidates have an exact latest-registration composite index');

insert into public.organizations(id,name,slug,timezone,terminology,sport_defaults,tag_defaults)
values('67000000-0000-4000-8000-000000000001','Tryout candidate index','tryout-candidate-index','America/Edmonton','{"athlete":"Player"}','["Hockey"]','[]');
insert into public.tryouts(id,organization_id,name,slug,sport,timezone)
values('67000000-0000-4000-8000-000000000002','67000000-0000-4000-8000-000000000001','Indexed','indexed','Hockey','America/Edmonton');
insert into public.tryout_divisions(id,organization_id,tryout_id,name,sort_order)
values('67000000-0000-4000-8000-000000000005','67000000-0000-4000-8000-000000000001','67000000-0000-4000-8000-000000000002','U15',0);
insert into public.registration_forms(id,organization_id,tryout_id,name)
values('67000000-0000-4000-8000-000000000003','67000000-0000-4000-8000-000000000001','67000000-0000-4000-8000-000000000002','Form');
insert into public.registration_form_versions(id,organization_id,tryout_id,registration_form_id,version_number,schema,status,published_at)
values('67000000-0000-4000-8000-000000000004','67000000-0000-4000-8000-000000000001','67000000-0000-4000-8000-000000000002','67000000-0000-4000-8000-000000000003',1,'{"fields":[]}','published',clock_timestamp());
insert into public.athletes(id,organization_id,given_name,family_name,normalized_given_name,normalized_family_name,birth_date) values
  ('67000000-0000-4000-8000-000000000011','67000000-0000-4000-8000-000000000001','One','Synthetic','one','synthetic','2012-01-01'),
  ('67000000-0000-4000-8000-000000000012','67000000-0000-4000-8000-000000000001','Two','Synthetic','two','synthetic','2012-01-02'),
  ('67000000-0000-4000-8000-000000000013','67000000-0000-4000-8000-000000000001','Three','Synthetic','three','synthetic','2012-01-03');
insert into public.tryout_registrations(id,organization_id,tryout_id,athlete_id,division_id,registration_form_version_id,responses,submission_key_digest,submission_digest,created_at) values
  ('67000000-0000-4000-8000-000000000021','67000000-0000-4000-8000-000000000001','67000000-0000-4000-8000-000000000002','67000000-0000-4000-8000-000000000011','67000000-0000-4000-8000-000000000005','67000000-0000-4000-8000-000000000004','{}',repeat('1',64),repeat('1',64),'2026-01-01 00:00:00+00'),
  ('67000000-0000-4000-8000-000000000022','67000000-0000-4000-8000-000000000001','67000000-0000-4000-8000-000000000002','67000000-0000-4000-8000-000000000011','67000000-0000-4000-8000-000000000005','67000000-0000-4000-8000-000000000004','{}',repeat('2',64),repeat('2',64),'2026-01-02 00:00:00+00'),
  ('67000000-0000-4000-8000-000000000023','67000000-0000-4000-8000-000000000001','67000000-0000-4000-8000-000000000002','67000000-0000-4000-8000-000000000012','67000000-0000-4000-8000-000000000005','67000000-0000-4000-8000-000000000004','{}',repeat('3',64),repeat('3',64),'2026-01-03 00:00:00+00'),
  ('67000000-0000-4000-8000-000000000024','67000000-0000-4000-8000-000000000001','67000000-0000-4000-8000-000000000002','67000000-0000-4000-8000-000000000013','67000000-0000-4000-8000-000000000005','67000000-0000-4000-8000-000000000004','{}',repeat('4',64),repeat('4',64),'2026-01-04 00:00:00+00');

-- Make the EXPLAIN fixture large enough that the cap must be applied before
-- any descriptive report work; the four explicit rows above still cover the
-- duplicate-registration tie case.
insert into public.athletes(id,organization_id,given_name,family_name,normalized_given_name,normalized_family_name,birth_date)
select ('67000000-0000-4000-8001-'||lpad(to_hex(1000+series_number),12,'0'))::uuid,
  '67000000-0000-4000-8000-000000000001','Bulk '||series_number,'Synthetic','bulk '||series_number,'synthetic','2012-01-05'
from generate_series(1,1200) series_number;
insert into public.tryout_registrations(id,organization_id,tryout_id,athlete_id,division_id,registration_form_version_id,responses,submission_key_digest,submission_digest,created_at)
select ('67000000-0000-4000-8002-'||lpad(to_hex(1000+series_number),12,'0'))::uuid,
  '67000000-0000-4000-8000-000000000001','67000000-0000-4000-8000-000000000002',
  ('67000000-0000-4000-8001-'||lpad(to_hex(1000+series_number),12,'0'))::uuid,
  '67000000-0000-4000-8000-000000000005','67000000-0000-4000-8000-000000000004','{}',
  lpad(to_hex(10000+series_number),64,'0'),lpad(to_hex(20000+series_number),64,'0'),
  '2026-02-01 00:00:00+00'::timestamptz + series_number * interval '1 second'
from generate_series(1,1200) series_number;

select is((select array_agg(registration_id order by athlete_id) from private.bounded_report_athlete_candidates(
  '67000000-0000-4000-8000-000000000001','67000000-0000-4000-8000-000000000002',2)),
  array['67000000-0000-4000-8000-000000000022'::uuid,'67000000-0000-4000-8000-000000000023'::uuid,'67000000-0000-4000-8000-000000000024'::uuid],
  'tryout candidates choose each athlete latest registration in stable athlete order');
select is((select count(*)::integer from private.bounded_report_athlete_candidates(
  '67000000-0000-4000-8000-000000000001','67000000-0000-4000-8000-000000000002',2)),3,
  'tryout candidate work stops at maxRows plus one before descriptive joins');

create function pg_temp.explain_text(query text) returns text language plpgsql as $$
declare line text; output text:=''; begin
  for line in execute 'explain (costs false) '||query loop output:=output||line||E'\n'; end loop;
  return output;
end $$;
set local enable_seqscan=off;
select ok(pg_temp.explain_text($$select distinct on (registration.athlete_id) registration.athlete_id,registration.id
  from public.tryout_registrations registration
  where registration.organization_id='67000000-0000-4000-8000-000000000001'
    and registration.tryout_id='67000000-0000-4000-8000-000000000002'
  order by registration.athlete_id,registration.created_at desc,registration.id desc limit 3$$) ~ 'tryout_registrations_report_tryout_athlete_latest_idx',
  'forced realistic tryout candidate plan uses the exact composite index');
select ok(not (pg_temp.explain_text($$select distinct on (registration.athlete_id) registration.athlete_id,registration.id
  from public.tryout_registrations registration
  where registration.organization_id='67000000-0000-4000-8000-000000000001'
    and registration.tryout_id='67000000-0000-4000-8000-000000000002'
  order by registration.athlete_id,registration.created_at desc,registration.id desc limit 3$$) ~ 'Sort'),
  'candidate index plan avoids a pre-cap full tryout sort');
select ok(not (pg_temp.explain_text($$select distinct on (registration.athlete_id) registration.athlete_id,registration.id
  from public.tryout_registrations registration
  where registration.organization_id='67000000-0000-4000-8000-000000000001'
    and registration.tryout_id='67000000-0000-4000-8000-000000000002'
  order by registration.athlete_id,registration.created_at desc,registration.id desc limit 3$$) ~ 'Seq Scan'),
  'candidate index plan avoids a pre-cap full tryout scan');
select is((select proconfig from pg_proc where oid=to_regprocedure('private.bounded_report_athlete_candidates(uuid,uuid,integer)')),
  array['search_path=""']::text[],'tryout candidate helper retains an empty search path');
select is((select count(*)::integer from public.tryout_registrations where organization_id='67000000-0000-4000-8000-000000000001'),1204,
  'large tryout history remains preserved while latest selection is deterministic');

select * from finish();
rollback;
