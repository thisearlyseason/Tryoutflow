begin;
select plan(16);

select has_table('private','roster_report_snapshots','immutable roster report headers exist');
select has_table('private','roster_report_snapshot_items','immutable roster report items exist');
select has_function('private','calculate_report_evaluator_total',array['jsonb']);
select has_function('private','bounded_report_athlete_candidates',array['uuid','uuid','integer']);
select ok(
  not has_table_privilege('authenticated','private.roster_report_snapshots','select'),
  'authenticated cannot read private roster snapshot headers directly'
);
select ok(
  not has_table_privilege('authenticated','private.roster_report_snapshot_items','select'),
  'authenticated cannot read private roster snapshot items directly'
);
select ok(
  not has_function_privilege('authenticated','private.capture_roster_report_snapshot(uuid,uuid,uuid,uuid,timestamp with time zone)','execute'),
  'authenticated cannot invoke snapshot capture directly'
);
select ok(
  not has_function_privilege('authenticated','private.calculate_report_evaluator_total(jsonb)','execute'),
  'authenticated cannot invoke report math directly'
);
select is(
  private.calculate_report_evaluator_total('[{"categoryId":"a","score":5,"scaleMax":5,"weight":"90.00"},{"categoryId":"b","score":2,"scaleMax":10,"weight":"10.00"}]'),
  '92.0000',
  'report total matches Task 18 weighted 90/10 decimal semantics'
);
select is(
  private.calculate_report_evaluator_total('[{"categoryId":"a","score":4,"scaleMax":5,"weight":"50.00"},{"categoryId":"b","score":8,"scaleMax":10,"weight":"50.00"}]'),
  '80.0000',
  'mixed 5 and 10 scales normalize exactly before weighting'
);
select is(
  private.calculate_report_evaluator_total('[{"categoryId":"a","score":5,"scaleMax":5,"weight":"90.00"},{"categoryId":"b","score":null,"scaleMax":10,"weight":"10.00"}]'),
  null,
  'missing category does not become zero'
);
select throws_ok(
  $$select private.calculate_report_evaluator_total((select jsonb_agg(jsonb_build_object('categoryId',value::text,'score',5,'scaleMax',5,'weight','1.00')) from generate_series(1,101) value))$$,
  '54000',
  'report category cardinality exceeds 100',
  'nested score work is bounded'
);

insert into auth.users(id) values('65000000-0000-4000-8000-000000000001');
insert into public.organizations(id,name,slug,timezone,terminology,sport_defaults,tag_defaults)
values('65000000-0000-4000-8000-000000000002','Bounded Reports','bounded-reports','America/Edmonton','{"athlete":"Player"}','["Hockey"]','[]');
insert into public.organization_members(organization_id,user_id,role,status)
values('65000000-0000-4000-8000-000000000002','65000000-0000-4000-8000-000000000001','owner','active');
insert into public.athletes(id,organization_id,given_name,family_name,normalized_given_name,normalized_family_name,birth_date) values
  ('65000000-0000-4000-8000-000000000011','65000000-0000-4000-8000-000000000002','One','Synthetic','one','synthetic','2012-01-01'),
  ('65000000-0000-4000-8000-000000000012','65000000-0000-4000-8000-000000000002','Two','Synthetic','two','synthetic','2012-01-02'),
  ('65000000-0000-4000-8000-000000000013','65000000-0000-4000-8000-000000000002','Three','Synthetic','three','synthetic','2012-01-03');

select is(
  (select count(*)::integer from private.bounded_report_athlete_candidates('65000000-0000-4000-8000-000000000002',null,1)),
  2,
  'candidate scan performs max rows plus one work'
);
set local role authenticated;
select set_config('request.jwt.claim.sub','65000000-0000-4000-8000-000000000001',true);
select is(
  (select jsonb_array_length(result->'rows') from public.load_report_export('65000000-0000-4000-8000-000000000002','athletes',null,null,1)),
  1,
  'bounded export returns no partial overflow row'
);
select is(
  (select result->>'truncated' from public.load_report_export('65000000-0000-4000-8000-000000000002','athletes',null,null,1)),
  'true',
  'bounded export signals overflow'
);
reset role;

select is((select proconfig from pg_proc where oid=to_regprocedure('public.load_report_export(uuid,text,uuid,uuid,integer)')),array['search_path=""']::text[],'replacement export keeps empty search path');

select * from finish();
rollback;
