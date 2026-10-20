begin;
select no_plan();

insert into auth.users(id) values('97111111-1111-4111-8111-111111111111');
insert into public.organizations(id,name,slug,timezone)
values('97222222-2222-4222-8222-222222222222','Reparent Contract Club','reparent-contract-club','America/Edmonton');
insert into public.tryouts(id,organization_id,name,slug,sport,timezone)
values('97333333-3333-4333-8333-333333333333','97222222-2222-4222-8222-222222222222','Reparent Contract','reparent-contract','Hockey','America/Edmonton');
insert into public.tryout_divisions(id,organization_id,tryout_id,name,sort_order)
values('97444444-4444-4444-8444-444444444444','97222222-2222-4222-8222-222222222222','97333333-3333-4333-8333-333333333333','U13',0);
insert into public.tryout_sessions(id,organization_id,tryout_id,division_id,name,starts_at,ends_at,sort_order) values
  ('97555555-5555-4555-8555-555555555551','97222222-2222-4222-8222-222222222222','97333333-3333-4333-8333-333333333333','97444444-4444-4444-8444-444444444444','Old session',clock_timestamp()+interval '1 day',clock_timestamp()+interval '1 day 1 hour',0),
  ('97555555-5555-4555-8555-555555555552','97222222-2222-4222-8222-222222222222','97333333-3333-4333-8333-333333333333','97444444-4444-4444-8444-444444444444','New session',clock_timestamp()+interval '1 day 2 hours',clock_timestamp()+interval '1 day 3 hours',1);
insert into public.session_groups(id,organization_id,tryout_id,session_id,name,sort_order) values
  ('97666666-6666-4666-8666-666666666661','97222222-2222-4222-8222-222222222222','97333333-3333-4333-8333-333333333333','97555555-5555-4555-8555-555555555551','Old group',0),
  ('97666666-6666-4666-8666-666666666662','97222222-2222-4222-8222-222222222222','97333333-3333-4333-8333-333333333333','97555555-5555-4555-8555-555555555552','New group',0);
insert into public.registration_forms(id,organization_id,tryout_id,name)
values('97777777-7777-4777-8777-777777777777','97222222-2222-4222-8222-222222222222','97333333-3333-4333-8333-333333333333','Form');
insert into public.registration_form_versions(id,organization_id,tryout_id,registration_form_id,version_number,schema,status,published_at)
values('97888888-8888-4888-8888-888888888888','97222222-2222-4222-8222-222222222222','97333333-3333-4333-8333-333333333333','97777777-7777-4777-8777-777777777777',1,'{"fields":[]}','published',clock_timestamp());
insert into public.athletes(id,organization_id,given_name,family_name,normalized_given_name,normalized_family_name,birth_date) values
  ('97999999-9999-4999-8999-999999999991','97222222-2222-4222-8222-222222222222','Old','Same','old','same','2013-01-01'),
  ('97999999-9999-4999-8999-999999999992','97222222-2222-4222-8222-222222222222','New','Same','new','same','2013-01-02'),
  ('97999999-9999-4999-8999-999999999993','97222222-2222-4222-8222-222222222222','Old','Combined','old','combined','2013-01-03'),
  ('97999999-9999-4999-8999-999999999994','97222222-2222-4222-8222-222222222222','New','Combined','new','combined','2013-01-04');
insert into public.tryout_registrations(id,organization_id,tryout_id,athlete_id,division_id,registration_form_version_id,responses,submission_key_digest,submission_digest) values
  ('97000000-0000-4000-8000-000000000001','97222222-2222-4222-8222-222222222222','97333333-3333-4333-8333-333333333333','97999999-9999-4999-8999-999999999991','97444444-4444-4444-8444-444444444444','97888888-8888-4888-8888-888888888888','{}',repeat('a',64),repeat('1',64)),
  ('97000000-0000-4000-8000-000000000002','97222222-2222-4222-8222-222222222222','97333333-3333-4333-8333-333333333333','97999999-9999-4999-8999-999999999992','97444444-4444-4444-8444-444444444444','97888888-8888-4888-8888-888888888888','{}',repeat('b',64),repeat('2',64)),
  ('97000000-0000-4000-8000-000000000003','97222222-2222-4222-8222-222222222222','97333333-3333-4333-8333-333333333333','97999999-9999-4999-8999-999999999993','97444444-4444-4444-8444-444444444444','97888888-8888-4888-8888-888888888888','{}',repeat('c',64),repeat('3',64)),
  ('97000000-0000-4000-8000-000000000004','97222222-2222-4222-8222-222222222222','97333333-3333-4333-8333-333333333333','97999999-9999-4999-8999-999999999994','97444444-4444-4444-8444-444444444444','97888888-8888-4888-8888-888888888888','{}',repeat('d',64),repeat('4',64));

insert into public.session_enrollments(id,organization_id,tryout_id,registration_id,session_id,group_id) values
  ('97000000-0000-4000-8000-000000000011','97222222-2222-4222-8222-222222222222','97333333-3333-4333-8333-333333333333','97000000-0000-4000-8000-000000000001','97555555-5555-4555-8555-555555555551','97666666-6666-4666-8666-666666666661'),
  ('97000000-0000-4000-8000-000000000012','97222222-2222-4222-8222-222222222222','97333333-3333-4333-8333-333333333333','97000000-0000-4000-8000-000000000003','97555555-5555-4555-8555-555555555551','97666666-6666-4666-8666-666666666661');

insert into public.tryout_numbers(organization_id,tryout_id,registration_id,division_id,session_id,group_id,scope_kind,number,assigned_by_user_id) values
  ('97222222-2222-4222-8222-222222222222','97333333-3333-4333-8333-333333333333','97000000-0000-4000-8000-000000000001','97444444-4444-4444-8444-444444444444','97555555-5555-4555-8555-555555555551',null,'session',11,'97111111-1111-4111-8111-111111111111'),
  ('97222222-2222-4222-8222-222222222222','97333333-3333-4333-8333-333333333333','97000000-0000-4000-8000-000000000001','97444444-4444-4444-8444-444444444444','97555555-5555-4555-8555-555555555551','97666666-6666-4666-8666-666666666661','group',12,'97111111-1111-4111-8111-111111111111'),
  ('97222222-2222-4222-8222-222222222222','97333333-3333-4333-8333-333333333333','97000000-0000-4000-8000-000000000002','97444444-4444-4444-8444-444444444444','97555555-5555-4555-8555-555555555551',null,'session',21,'97111111-1111-4111-8111-111111111111'),
  ('97222222-2222-4222-8222-222222222222','97333333-3333-4333-8333-333333333333','97000000-0000-4000-8000-000000000002','97444444-4444-4444-8444-444444444444','97555555-5555-4555-8555-555555555551','97666666-6666-4666-8666-666666666661','group',22,'97111111-1111-4111-8111-111111111111'),
  ('97222222-2222-4222-8222-222222222222','97333333-3333-4333-8333-333333333333','97000000-0000-4000-8000-000000000003','97444444-4444-4444-8444-444444444444','97555555-5555-4555-8555-555555555551',null,'session',13,'97111111-1111-4111-8111-111111111111'),
  ('97222222-2222-4222-8222-222222222222','97333333-3333-4333-8333-333333333333','97000000-0000-4000-8000-000000000003','97444444-4444-4444-8444-444444444444','97555555-5555-4555-8555-555555555551','97666666-6666-4666-8666-666666666661','group',14,'97111111-1111-4111-8111-111111111111'),
  ('97222222-2222-4222-8222-222222222222','97333333-3333-4333-8333-333333333333','97000000-0000-4000-8000-000000000004','97444444-4444-4444-8444-444444444444','97555555-5555-4555-8555-555555555551',null,'session',23,'97111111-1111-4111-8111-111111111111'),
  ('97222222-2222-4222-8222-222222222222','97333333-3333-4333-8333-333333333333','97000000-0000-4000-8000-000000000004','97444444-4444-4444-8444-444444444444','97555555-5555-4555-8555-555555555551','97666666-6666-4666-8666-666666666661','group',24,'97111111-1111-4111-8111-111111111111'),
  ('97222222-2222-4222-8222-222222222222','97333333-3333-4333-8333-333333333333','97000000-0000-4000-8000-000000000004','97444444-4444-4444-8444-444444444444','97555555-5555-4555-8555-555555555552',null,'session',25,'97111111-1111-4111-8111-111111111111'),
  ('97222222-2222-4222-8222-222222222222','97333333-3333-4333-8333-333333333333','97000000-0000-4000-8000-000000000004','97444444-4444-4444-8444-444444444444','97555555-5555-4555-8555-555555555552','97666666-6666-4666-8666-666666666662','group',26,'97111111-1111-4111-8111-111111111111');

update public.session_enrollments set registration_id='97000000-0000-4000-8000-000000000002'
where id='97000000-0000-4000-8000-000000000011';
select is((select count(*) from public.tryout_numbers where registration_id='97000000-0000-4000-8000-000000000001' and released_at is null),0::bigint,
  'same-placement reparent releases every stale OLD-registration placement number');
select is((select count(*) from public.tryout_numbers where registration_id='97000000-0000-4000-8000-000000000002' and released_at is null),2::bigint,
  'same-placement reparent does not release unrelated NEW-registration numbers');
select is((select count(*) from public.audit_logs where organization_id='97222222-2222-4222-8222-222222222222'
  and action='checkin.number_released' and actor_user_id is null and details->>'reason'='reparented'
  and details->>'registrationId'='97000000-0000-4000-8000-000000000001'
  and details->'before'->>'releasedAt' is null and details->'after'->>'releasedAt' is not null
  and details->'scope'->>'sessionId'='97555555-5555-4555-8555-555555555551'),2::bigint,
  'same-placement reparent appends exactly two truthful system release audits for OLD');
select is((select array_agg((details->'before'->>'number')::integer order by (details->'before'->>'number')::integer)||
    array_agg((details->'after'->>'number')::integer order by (details->'after'->>'number')::integer)
  from public.audit_logs where organization_id='97222222-2222-4222-8222-222222222222'
    and action='checkin.number_released' and details->>'reason'='reparented'
    and details->>'registrationId'='97000000-0000-4000-8000-000000000001'),array[11,12,11,12],
  'same-placement reparent audits preserve exact before/after number snapshots');

update public.session_enrollments set
  registration_id='97000000-0000-4000-8000-000000000004',
  session_id='97555555-5555-4555-8555-555555555552',
  group_id='97666666-6666-4666-8666-666666666662'
where id='97000000-0000-4000-8000-000000000012';
select is((select count(*) from public.tryout_numbers where registration_id='97000000-0000-4000-8000-000000000003' and released_at is null),0::bigint,
  'combined placement reparent releases every stale OLD-registration placement number');
select is((select count(*) from public.tryout_numbers where registration_id='97000000-0000-4000-8000-000000000004' and released_at is null),4::bigint,
  'combined placement reparent leaves all NEW-registration numbers untouched');
select is((select count(*) from public.audit_logs where organization_id='97222222-2222-4222-8222-222222222222'
  and action='checkin.number_released' and actor_user_id is null and details->>'reason'='reparented'
  and details->>'registrationId'='97000000-0000-4000-8000-000000000003'
  and details->'before'->>'releasedAt' is null and details->'after'->>'releasedAt' is not null
  and details->'scope'->>'sessionId'='97555555-5555-4555-8555-555555555551'),2::bigint,
  'combined placement reparent appends exactly two truthful system release audits for OLD');
select is((select array_agg((details->'before'->>'number')::integer order by (details->'before'->>'number')::integer)||
    array_agg((details->'after'->>'number')::integer order by (details->'after'->>'number')::integer)
  from public.audit_logs where organization_id='97222222-2222-4222-8222-222222222222'
    and action='checkin.number_released' and details->>'reason'='reparented'
    and details->>'registrationId'='97000000-0000-4000-8000-000000000003'),array[13,14,13,14],
  'combined placement reparent audits preserve exact before/after number snapshots');

update public.session_enrollments set group_id=null
where id='97000000-0000-4000-8000-000000000012';
select is((select count(*) from public.tryout_numbers where registration_id='97000000-0000-4000-8000-000000000004'
  and session_id='97555555-5555-4555-8555-555555555552' and scope_kind='session' and released_at is null),1::bigint,
  'a group-only move retains the still-valid session-scoped number');
select is((select count(*) from public.audit_logs where organization_id='97222222-2222-4222-8222-222222222222'
  and action='checkin.number_released' and actor_user_id is null and details->>'reason'='placement_changed'
  and details->>'registrationId'='97000000-0000-4000-8000-000000000004'
  and details->'scope'->>'groupId'='97666666-6666-4666-8666-666666666662'),1::bigint,
  'a group-only move appends exactly one placement_changed system audit');

delete from public.session_enrollments where id='97000000-0000-4000-8000-000000000011';
select is((select count(*) from public.tryout_numbers where registration_id='97000000-0000-4000-8000-000000000002' and released_at is null),0::bigint,
  'enrollment deletion still releases the removed placement numbers');
select is((select count(*) from public.audit_logs where organization_id='97222222-2222-4222-8222-222222222222'
  and action='checkin.number_released' and actor_user_id is null and details->>'reason'='placement_changed'
  and details->>'registrationId'='97000000-0000-4000-8000-000000000002'),2::bigint,
  'enrollment deletion still appends exact placement_changed system audits');

select * from finish();
rollback;
