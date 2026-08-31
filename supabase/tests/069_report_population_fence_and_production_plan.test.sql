begin;
select no_plan();

-- dblink gives this pgTAP file real, independently committing PostgreSQL
-- sessions.  The extension and every local helper disappear with the final
-- rollback; committed concurrency fixtures are removed explicitly below.
create extension if not exists dblink with schema extensions;

create function pg_temp.explain_json(query text) returns jsonb
language plpgsql volatile set search_path='' as $$
declare output jsonb;
begin
  execute 'explain (analyze,costs off,timing off,summary off,format json) '||query
    into output;
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
    cross join lateral jsonb_array_elements(
      coalesce(parent.node->'Plans','[]'::jsonb)
    ) child
  )
  select nodes.node from nodes;
$$;

create function pg_temp.dblink_connection_string(application_name text)
returns text language sql stable set search_path='' as $$
  select format(
    'host=%s port=%s dbname=%s user=postgres password=postgres application_name=%s',
    host(inet_server_addr()),inet_server_port(),current_database(),application_name
  );
$$;

create function pg_temp.wait_for_dblink(connection_name text)
returns void language plpgsql volatile set search_path='' as $$
declare deadline timestamptz:=clock_timestamp()+interval '10 seconds';
begin
  while extensions.dblink_is_busy(connection_name)=1 loop
    if clock_timestamp()>deadline then
      raise exception 'timed out waiting for dblink connection %',connection_name;
    end if;
    perform pg_catalog.pg_sleep(0.01);
  end loop;
end;
$$;

create function pg_temp.wait_for_block_or_result(
  connection_name text,application_name text
) returns boolean language plpgsql volatile set search_path='' as $$
declare deadline timestamptz:=clock_timestamp()+interval '2 seconds';
declare sustained_busy_at timestamptz:=clock_timestamp()+interval '200 milliseconds';
begin
  loop
    if exists(
      select 1 from pg_catalog.pg_stat_activity activity
      where activity.datname=current_database()
        and activity.application_name=wait_for_block_or_result.application_name
        and activity.wait_event_type='Lock'
        and cardinality(pg_catalog.pg_blocking_pids(activity.pid))>0
    ) then
      return true;
    end if;
    if extensions.dblink_is_busy(connection_name)=0 then return false; end if;
    if clock_timestamp()>=sustained_busy_at then return true; end if;
    if clock_timestamp()>deadline then
      raise exception 'could not classify dblink connection %',connection_name;
    end if;
    perform pg_catalog.pg_sleep(0.01);
  end loop;
end;
$$;

-- Run A->B against B->A.  Under 086, B's first different-key mutation
-- completes and the second pair deadlocks.  With the organization fence, B's
-- first mutation waits before it can own a per-key population row; A commits,
-- then B completes without a retry.
create function pg_temp.run_opposite_population_mutations(
  case_name text,first_a text,second_a text,first_b text,second_b text,
  replica_writes boolean default false
) returns jsonb language plpgsql volatile set search_path='' as $$
declare
  connection_a text:='r69_'||case_name||'_a';
  connection_b text:='r69_'||case_name||'_b';
  application_b text:='report-fence-'||case_name||'-b';
  result_a text; result_b text; first_b_result text;
  error_a text:='OK'; error_b text:='OK'; b_blocked boolean;
begin
  perform extensions.dblink_connect(
    connection_a,pg_temp.dblink_connection_string(
      'report-fence-'||case_name||'-a'
    )
  );
  perform extensions.dblink_connect(
    connection_b,pg_temp.dblink_connection_string(application_b)
  );
  perform extensions.dblink_exec(connection_a,
    'begin; set local deadlock_timeout=''100ms''; set local lock_timeout=''8s''');
  perform extensions.dblink_exec(connection_b,
    'begin; set local deadlock_timeout=''100ms''; set local lock_timeout=''8s''');
  if replica_writes then
    perform extensions.dblink_exec(connection_a,
      'set local session_replication_role=replica');
    perform extensions.dblink_exec(connection_b,
      'set local session_replication_role=replica');
  end if;

  select response.result into result_a
  from extensions.dblink(connection_a,first_a) as response(result text);
  perform extensions.dblink_send_query(connection_b,first_b);
  b_blocked:=pg_temp.wait_for_block_or_result(connection_b,application_b);

  if b_blocked then
    select response.result into result_a
    from extensions.dblink(connection_a,second_a) as response(result text);
    perform extensions.dblink_exec(connection_a,'commit');
    perform pg_temp.wait_for_dblink(connection_b);
    select response.result into first_b_result
    from extensions.dblink_get_result(connection_b,false) as response(result text);
    error_b:=extensions.dblink_error_message(connection_b);
    perform response.result
    from extensions.dblink_get_result(connection_b,false) as response(result text);
    if error_b='OK' then
      select response.result into result_b
      from extensions.dblink(connection_b,second_b) as response(result text);
      perform extensions.dblink_exec(connection_b,'commit');
    else
      perform extensions.dblink_exec(connection_b,'rollback',false);
    end if;
  else
    perform pg_temp.wait_for_dblink(connection_b);
    select response.result into first_b_result
    from extensions.dblink_get_result(connection_b,false) as response(result text);
    error_b:=extensions.dblink_error_message(connection_b);
    perform response.result
    from extensions.dblink_get_result(connection_b,false) as response(result text);
    perform extensions.dblink_send_query(connection_a,second_a);
    perform extensions.dblink_send_query(connection_b,second_b);
    perform pg_temp.wait_for_dblink(connection_a);
    perform pg_temp.wait_for_dblink(connection_b);
    select response.result into result_a
    from extensions.dblink_get_result(connection_a,false) as response(result text);
    error_a:=extensions.dblink_error_message(connection_a);
    perform response.result
    from extensions.dblink_get_result(connection_a,false) as response(result text);
    select response.result into result_b
    from extensions.dblink_get_result(connection_b,false) as response(result text);
    error_b:=extensions.dblink_error_message(connection_b);
    perform response.result
    from extensions.dblink_get_result(connection_b,false) as response(result text);
    if error_a='OK' then
      perform extensions.dblink_exec(connection_a,'commit');
    else
      perform extensions.dblink_exec(connection_a,'rollback',false);
    end if;
    if error_b='OK' then
      perform extensions.dblink_exec(connection_b,'commit');
    else
      perform extensions.dblink_exec(connection_b,'rollback',false);
    end if;
  end if;

  perform extensions.dblink_disconnect(connection_a);
  perform extensions.dblink_disconnect(connection_b);
  return jsonb_build_object(
    'bBlockedBeforePerKeyLock',b_blocked,
    'aError',error_a,'bError',error_b,
    'aResult',result_a,'bFirstResult',first_b_result,'bResult',result_b
  );
exception when others then
  begin perform extensions.dblink_exec(connection_a,'rollback',false);
  exception when others then null; end;
  begin perform extensions.dblink_exec(connection_b,'rollback',false);
  exception when others then null; end;
  begin perform extensions.dblink_disconnect(connection_a);
  exception when others then null; end;
  begin perform extensions.dblink_disconnect(connection_b);
  exception when others then null; end;
  raise;
end;
$$;

create function pg_temp.run_blocked_then_release(
  case_name text,first_a text,first_b text,rollback_a boolean
) returns jsonb language plpgsql volatile set search_path='' as $$
declare
  connection_a text:='r69_'||case_name||'_a';
  connection_b text:='r69_'||case_name||'_b';
  application_b text:='report-fence-'||case_name||'-b';
  result_a text; result_b text; error_b text; b_blocked boolean;
begin
  perform extensions.dblink_connect(
    connection_a,pg_temp.dblink_connection_string(
      'report-fence-'||case_name||'-a'
    ));
  perform extensions.dblink_connect(
    connection_b,pg_temp.dblink_connection_string(application_b));
  perform extensions.dblink_exec(connection_a,
    'begin; set local lock_timeout=''8s''');
  perform extensions.dblink_exec(connection_b,
    'begin; set local lock_timeout=''8s''');
  select response.result into result_a
  from extensions.dblink(connection_a,first_a) as response(result text);
  perform extensions.dblink_send_query(connection_b,first_b);
  b_blocked:=pg_temp.wait_for_block_or_result(connection_b,application_b);
  perform extensions.dblink_exec(connection_a,
    case when rollback_a then 'rollback' else 'commit' end);
  perform pg_temp.wait_for_dblink(connection_b);
  select response.result into result_b
  from extensions.dblink_get_result(connection_b,false) as response(result text);
  error_b:=extensions.dblink_error_message(connection_b);
  perform response.result
  from extensions.dblink_get_result(connection_b,false) as response(result text);
  if error_b='OK' then
    perform extensions.dblink_exec(connection_b,'commit');
  else
    perform extensions.dblink_exec(connection_b,'rollback',false);
  end if;
  perform extensions.dblink_disconnect(connection_a);
  perform extensions.dblink_disconnect(connection_b);
  return jsonb_build_object('bBlocked',b_blocked,'bError',error_b,
    'aResult',result_a,'bResult',result_b);
exception when others then
  begin perform extensions.dblink_exec(connection_a,'rollback',false);
  exception when others then null; end;
  begin perform extensions.dblink_exec(connection_b,'rollback',false);
  exception when others then null; end;
  begin perform extensions.dblink_disconnect(connection_a);
  exception when others then null; end;
  begin perform extensions.dblink_disconnect(connection_b);
  exception when others then null; end;
  raise;
end;
$$;

-- The fence is a collision-free durable UUID key, private, and inaccessible to
-- every client role.  The old security-definer helper remains as a compatibility
-- wrapper; production uses the new invoker helper directly.
select has_table('private','report_population_organization_fences',
  'population maintenance has a durable organization transaction fence');
select is((select count(*) from pg_catalog.pg_constraint
  where conrelid=to_regclass('private.report_population_organization_fences')
    and contype='p'),1::bigint,'the organization UUID is the exact fence key');
select is((select count(*) from pg_catalog.pg_constraint
  where conrelid=to_regclass('private.report_population_organization_fences')
    and contype='f' and confdeltype='c'),1::bigint,
  'organization deletion cascades its private fence');
select is((select relrowsecurity from pg_catalog.pg_class
  where oid=to_regclass('private.report_population_organization_fences')),true,
  'the private fence retains defense-in-depth RLS');
select table_privs_are('private','report_population_organization_fences',
  'authenticated',array[]::text[],
  'authenticated clients cannot read or lock organization fences');
select table_privs_are('private','report_population_organization_fences',
  'anon',array[]::text[],'anonymous clients cannot access organization fences');
select table_privs_are('private','report_population_organization_fences',
  'service_role',array[]::text[],
  'service role cannot bypass the owner-only fence boundary');

select has_function('private','lock_report_population_organization',array['uuid'],
  'row maintenance has one organization fence primitive');
select has_function('private','lock_all_report_population_organizations',array[]::text[],
  'truncate and rebuild have a canonical all-organization fence primitive');
select has_function('private','cleanup_report_population_organization_fence',array[]::text[],
  'replica-role organization deletion has an explicit fence cleanup primitive');
select trigger_is('public','organizations',
  'cleanup_report_population_organization_fence','private',
  'cleanup_report_population_organization_fence',
  'organization deletion removes its durable population fence');
select is((select tgenabled from pg_catalog.pg_trigger
  where tgrelid='public.organizations'::regclass
    and tgname='cleanup_report_population_organization_fence'),'A'::"char",
  'organization fence cleanup remains active for replica-role owner writes');
select has_function('private','explainable_report_athlete_candidates',
  array['uuid','uuid','integer'],
  'production candidate selection has an explainable private function');
select function_privs_are('private','explainable_report_athlete_candidates',
  array['uuid','uuid','integer'],'authenticated',array[]::text[],
  'authenticated clients cannot execute the explainable helper');
select function_privs_are('private','explainable_report_athlete_candidates',
  array['uuid','uuid','integer'],'service_role',array[]::text[],
  'service role cannot execute the explainable helper directly');
select is((select prosecdef from pg_catalog.pg_proc
  where oid=to_regprocedure(
    'private.explainable_report_athlete_candidates(uuid,uuid,integer)'
  )),false,'the explainable helper is SECURITY INVOKER');
select is((select provolatile from pg_catalog.pg_proc
  where oid=to_regprocedure(
    'private.explainable_report_athlete_candidates(uuid,uuid,integer)'
  )),'s'::"char",'the explainable helper is stable');
select is((select proconfig from pg_catalog.pg_proc
  where oid=to_regprocedure(
    'private.explainable_report_athlete_candidates(uuid,uuid,integer)'
  )),null::text[],
  'the fully qualified invoker helper has no SET clause that prevents inlining');
select ok(coalesce(pg_get_functiondef(to_regprocedure(
  'private.explainable_report_athlete_candidates(uuid,uuid,integer)'
)) !~* '\\mdistinct[[:space:]]+on\\M',false),
  'candidate helper cannot regress to duplicate-history DISTINCT ON');
select ok(coalesce(pg_get_functiondef(to_regprocedure(
  'public.load_report_export(uuid,text,uuid,uuid,integer)'
)) ~ 'private[.]explainable_report_athlete_candidates',false),
  'the production report export calls the exact explainable helper');
select ok(coalesce(pg_get_functiondef(to_regprocedure(
  'public.load_report_export(uuid,text,uuid,uuid,integer)'
)) !~ 'private[.]bounded_report_athlete_candidates',false),
  'production does not hide candidate work behind the definer wrapper');
select ok(coalesce(strpos(pg_get_functiondef(to_regprocedure(
  'private.maintain_report_tryout_athlete_population()'
)),'lock_report_population_organization')>0,false),
  'insert and delete maintenance enter the organization fence');
select ok(coalesce(strpos(pg_get_functiondef(to_regprocedure(
  'private.maintain_report_tryout_athlete_population()'
)),'lock_all_report_population_organizations')>0,false),
  'truncate maintenance enters every organization fence canonically');
select ok(coalesce(
  strpos(pg_get_functiondef(to_regprocedure(
    'private.rebuild_report_tryout_athlete_population()'
  )),'lock_all_report_population_organizations')
  < strpos(pg_get_functiondef(to_regprocedure(
    'private.rebuild_report_tryout_athlete_population()'
  )),'insert into private.report_tryout_athlete_population'),false),
  'rebuild acquires all fences before its first population mutation');

insert into public.organizations(id,name,slug,timezone,terminology,sport_defaults,tag_defaults)
values('69300000-0000-4000-8000-000000000001','Replica fence cleanup',
  'replica-fence-cleanup','America/Edmonton','{"athlete":"Player"}','["Hockey"]','[]');
select ok(private.lock_report_population_organization(
  '69300000-0000-4000-8000-000000000001'
),'the replica-delete fixture acquires a durable fence');
set local session_replication_role=replica;
delete from public.organizations
where id='69300000-0000-4000-8000-000000000001';
set local session_replication_role=origin;
select is((select count(*) from private.report_population_organization_fences
  where organization_id='69300000-0000-4000-8000-000000000001'),0::bigint,
  'replica-role owner deletion leaves no stale organization fence');

-- Performance fixture: 12,000 histories for the lexically first athlete must
-- not be visible as 12,000 units of work in the actual production helper plan.
insert into public.organizations(id,name,slug,timezone,terminology,sport_defaults,tag_defaults)
values('69000000-0000-4000-8000-000000000001','Production helper plan',
  'production-helper-plan','America/Edmonton','{"athlete":"Player"}',
  '["Hockey"]','[]');
insert into public.tryouts(id,organization_id,name,slug,sport,timezone) values
  ('69000000-0000-4000-8000-000000000011','69000000-0000-4000-8000-000000000001',
   'Primary','production-helper-plan-primary','Hockey','America/Edmonton'),
  ('69000000-0000-4000-8000-000000000012','69000000-0000-4000-8000-000000000001',
   'Secondary','production-helper-plan-secondary','Hockey','America/Edmonton');
insert into public.tryout_divisions(id,organization_id,tryout_id,name,sort_order) values
  ('69000000-0000-4000-8000-000000000021','69000000-0000-4000-8000-000000000001',
   '69000000-0000-4000-8000-000000000011','U15',0),
  ('69000000-0000-4000-8000-000000000022','69000000-0000-4000-8000-000000000001',
   '69000000-0000-4000-8000-000000000012','U16',0);
insert into public.registration_forms(id,organization_id,tryout_id,name) values
  ('69000000-0000-4000-8000-000000000031','69000000-0000-4000-8000-000000000001',
   '69000000-0000-4000-8000-000000000011','Primary Form'),
  ('69000000-0000-4000-8000-000000000032','69000000-0000-4000-8000-000000000001',
   '69000000-0000-4000-8000-000000000012','Secondary Form');
insert into public.registration_form_versions(
  id,organization_id,tryout_id,registration_form_id,version_number,schema,status
) values(
  '69000000-0000-4000-8000-000000000041','69000000-0000-4000-8000-000000000001',
  '69000000-0000-4000-8000-000000000011','69000000-0000-4000-8000-000000000031',
  1,'{"fields":[]}','draft'
),(
  '69000000-0000-4000-8000-000000000042','69000000-0000-4000-8000-000000000001',
  '69000000-0000-4000-8000-000000000012','69000000-0000-4000-8000-000000000032',
  1,'{"fields":[]}','draft'
);
insert into public.athletes(
  id,organization_id,given_name,family_name,normalized_given_name,
  normalized_family_name,birth_date
) values
  ('69000000-0000-4000-8000-000000000101','69000000-0000-4000-8000-000000000001','First','History','first','history','2012-01-01'),
  ('69000000-0000-4000-8000-000000000102','69000000-0000-4000-8000-000000000001','Second','Athlete','second','athlete','2012-01-02'),
  ('69000000-0000-4000-8000-000000000103','69000000-0000-4000-8000-000000000001','Third','Athlete','third','athlete','2012-01-03');
insert into public.tryout_registrations(
  id,organization_id,tryout_id,athlete_id,division_id,
  registration_form_version_id,responses,submission_key_digest,
  submission_digest,created_at
)
select ('69000000-0000-4000-8001-'||lpad(to_hex(item),12,'0'))::uuid,
  '69000000-0000-4000-8000-000000000001','69000000-0000-4000-8000-000000000011',
  '69000000-0000-4000-8000-000000000101','69000000-0000-4000-8000-000000000021',
  '69000000-0000-4000-8000-000000000041','{}',
  encode(extensions.digest('r69-key-'||item,'sha256'),'hex'),
  encode(extensions.digest('r69-body-'||item,'sha256'),'hex'),
  '2026-01-01 00:00:00+00'::timestamptz+item*interval '1 second'
from generate_series(1,12000) item;
insert into public.tryout_registrations(
  id,organization_id,tryout_id,athlete_id,division_id,
  registration_form_version_id,responses,submission_key_digest,
  submission_digest,created_at
) values
  ('69000000-0000-4000-8002-000000000001','69000000-0000-4000-8000-000000000001','69000000-0000-4000-8000-000000000011','69000000-0000-4000-8000-000000000102','69000000-0000-4000-8000-000000000021','69000000-0000-4000-8000-000000000041','{}',repeat('a1',32),repeat('a2',32),'2026-02-01 00:00:00+00'),
  ('69000000-0000-4000-8002-000000000002','69000000-0000-4000-8000-000000000001','69000000-0000-4000-8000-000000000011','69000000-0000-4000-8000-000000000103','69000000-0000-4000-8000-000000000021','69000000-0000-4000-8000-000000000041','{}',repeat('a3',32),repeat('a4',32),'2026-02-02 00:00:00+00');
insert into public.tryout_registrations(
  id,organization_id,tryout_id,athlete_id,division_id,
  registration_form_version_id,responses,submission_key_digest,
  submission_digest,created_at
)
select ('69000000-0000-4000-8004-'||lpad(to_hex(item),12,'0'))::uuid,
  '69000000-0000-4000-8000-000000000001','69000000-0000-4000-8000-000000000012',
  '69000000-0000-4000-8000-000000000101','69000000-0000-4000-8000-000000000022',
  '69000000-0000-4000-8000-000000000042','{}',
  encode(extensions.digest('r69-secondary-key-'||item,'sha256'),'hex'),
  encode(extensions.digest('r69-secondary-body-'||item,'sha256'),'hex'),
  '2027-01-01 00:00:00+00'::timestamptz+item*interval '1 second'
from generate_series(1,12000) item;
analyze public.tryout_registrations;
set local enable_seqscan=off;
create temporary table production_helper_plan(explanation jsonb);
do $$
begin
  if to_regprocedure(
    'private.explainable_report_athlete_candidates(uuid,uuid,integer)'
  ) is not null then
    insert into production_helper_plan
    select pg_temp.explain_json($query$
      select * from private.explainable_report_athlete_candidates(
        '69000000-0000-4000-8000-000000000001',
        '69000000-0000-4000-8000-000000000011',2
      )
    $query$);
  end if;
end;
$$;
select ok(exists(select 1 from production_helper_plan),
  'EXPLAIN ANALYZE executes the exact production candidate helper');
select ok(not exists(select 1 from production_helper_plan,
  lateral pg_temp.plan_nodes(explanation)
  where node->>'Node Type'='Function Scan'),
  'the production helper is inlined instead of hiding work in a Function Scan');
select diag('production helper leaf rows: population='||(select coalesce(sum(
  (node->>'Actual Rows')::numeric*(node->>'Actual Loops')::numeric
),0)::bigint from production_helper_plan,lateral pg_temp.plan_nodes(explanation)
  where node->>'Relation Name'='report_tryout_athlete_population')
  ||', registrations='||(select coalesce(sum(
  (node->>'Actual Rows')::numeric*(node->>'Actual Loops')::numeric
),0)::bigint from production_helper_plan,lateral pg_temp.plan_nodes(explanation)
  where node->>'Relation Name'='tryout_registrations'));
select cmp_ok((select coalesce(sum(
  (node->>'Actual Rows')::numeric*(node->>'Actual Loops')::numeric
),0)::bigint from production_helper_plan,lateral pg_temp.plan_nodes(explanation)
  where node->>'Relation Name'='report_tryout_athlete_population'),
  '<=',3::bigint,
  'the actual production call reads at most maxRows plus one population rows');
select cmp_ok((select coalesce(sum(
  (node->>'Actual Rows')::numeric*(node->>'Actual Loops')::numeric
),0)::bigint from production_helper_plan,lateral pg_temp.plan_nodes(explanation)
  where node->>'Relation Name'='tryout_registrations'),
  '<=',3::bigint,
  'the actual production call reads at most one latest row per candidate');
select ok(not exists(select 1 from production_helper_plan,
  lateral pg_temp.plan_nodes(explanation)
  where node->>'Node Type'='Seq Scan'),
  'the actual production candidate call contains no sequential scan');
select ok(not exists(select 1 from production_helper_plan,
  lateral pg_temp.plan_nodes(explanation)
  where node->>'Node Type'='Sort'
    and (node->>'Actual Rows')::numeric*(node->>'Actual Loops')::numeric>3),
  'the actual production candidate call contains no history-sized sort');
select diag('production helper indexes: '||coalesce((select string_agg(
  distinct node->>'Index Name',', ' order by node->>'Index Name'
) from production_helper_plan,lateral pg_temp.plan_nodes(explanation)
  where node ? 'Index Name'),'none'));
select ok(coalesce((select array_agg(distinct node->>'Index Name')
  from production_helper_plan,lateral pg_temp.plan_nodes(explanation)
  where node ? 'Index Name'),array[]::text[]) @> array[
    'report_tryout_athlete_population_pkey',
    'tryout_registrations_report_tryout_athlete_latest_idx'
  ],'the actual production call uses both exact candidate indexes');

-- Build committed fixtures visible to the independent dblink sessions.
select extensions.dblink_connect(
  'r69_setup',pg_temp.dblink_connection_string('report-fence-setup')
);
select extensions.dblink_exec('r69_setup',$setup$
  delete from public.tryout_registrations where organization_id in(
    '69100000-0000-4000-8000-000000000001','69200000-0000-4000-8000-000000000001');
  delete from public.registration_form_versions where organization_id in(
    '69100000-0000-4000-8000-000000000001','69200000-0000-4000-8000-000000000001');
  delete from public.registration_forms where organization_id in(
    '69100000-0000-4000-8000-000000000001','69200000-0000-4000-8000-000000000001');
  delete from public.tryout_divisions where organization_id in(
    '69100000-0000-4000-8000-000000000001','69200000-0000-4000-8000-000000000001');
  delete from public.tryouts where organization_id in(
    '69100000-0000-4000-8000-000000000001','69200000-0000-4000-8000-000000000001');
  delete from public.athletes where organization_id in(
    '69100000-0000-4000-8000-000000000001','69200000-0000-4000-8000-000000000001');
  delete from public.organizations where id in(
    '69100000-0000-4000-8000-000000000001','69200000-0000-4000-8000-000000000001');
  insert into public.organizations(id,name,slug,timezone,terminology,sport_defaults,tag_defaults) values
    ('69100000-0000-4000-8000-000000000001','Fence primary','report-fence-primary','America/Edmonton','{"athlete":"Player"}','["Hockey"]','[]'),
    ('69200000-0000-4000-8000-000000000001','Fence parallel','report-fence-parallel','America/Edmonton','{"athlete":"Player"}','["Hockey"]','[]');
  insert into public.tryouts(id,organization_id,name,slug,sport,timezone) values
    ('69100000-0000-4000-8000-000000000011','69100000-0000-4000-8000-000000000001','Primary','report-fence-primary-tryout','Hockey','America/Edmonton'),
    ('69200000-0000-4000-8000-000000000011','69200000-0000-4000-8000-000000000001','Parallel','report-fence-parallel-tryout','Hockey','America/Edmonton');
  insert into public.tryout_divisions(id,organization_id,tryout_id,name,sort_order) values
    ('69100000-0000-4000-8000-000000000021','69100000-0000-4000-8000-000000000001','69100000-0000-4000-8000-000000000011','U15',0),
    ('69200000-0000-4000-8000-000000000021','69200000-0000-4000-8000-000000000001','69200000-0000-4000-8000-000000000011','U15',0);
  insert into public.registration_forms(id,organization_id,tryout_id,name) values
    ('69100000-0000-4000-8000-000000000031','69100000-0000-4000-8000-000000000001','69100000-0000-4000-8000-000000000011','Form'),
    ('69200000-0000-4000-8000-000000000031','69200000-0000-4000-8000-000000000001','69200000-0000-4000-8000-000000000011','Form');
  insert into public.registration_form_versions(id,organization_id,tryout_id,registration_form_id,version_number,schema,status) values
    ('69100000-0000-4000-8000-000000000041','69100000-0000-4000-8000-000000000001','69100000-0000-4000-8000-000000000011','69100000-0000-4000-8000-000000000031',1,'{"fields":[]}','draft'),
    ('69200000-0000-4000-8000-000000000041','69200000-0000-4000-8000-000000000001','69200000-0000-4000-8000-000000000011','69200000-0000-4000-8000-000000000031',1,'{"fields":[]}','draft');
  insert into public.athletes(id,organization_id,given_name,family_name,normalized_given_name,normalized_family_name,birth_date)
  select ('69100000-0000-4000-8000-'||lpad(item::text,12,'0'))::uuid,
    '69100000-0000-4000-8000-000000000001','Athlete '||item,'Fence',
    'athlete '||item,'fence','2012-01-01'::date
  from generate_series(101,109) item;
  insert into public.athletes(id,organization_id,given_name,family_name,normalized_given_name,normalized_family_name,birth_date) values
    ('69200000-0000-4000-8000-000000000201','69200000-0000-4000-8000-000000000001','Parallel','Athlete','parallel','athlete','2012-01-01');
  insert into public.tryout_registrations(id,organization_id,tryout_id,athlete_id,division_id,registration_form_version_id,responses,submission_key_digest,submission_digest) values
    ('69100000-0000-4000-8001-000000001031','69100000-0000-4000-8000-000000000001','69100000-0000-4000-8000-000000000011','69100000-0000-4000-8000-000000000103','69100000-0000-4000-8000-000000000021','69100000-0000-4000-8000-000000000041','{}',repeat('31',32),repeat('a1',32)),
    ('69100000-0000-4000-8001-000000001032','69100000-0000-4000-8000-000000000001','69100000-0000-4000-8000-000000000011','69100000-0000-4000-8000-000000000103','69100000-0000-4000-8000-000000000021','69100000-0000-4000-8000-000000000041','{}',repeat('32',32),repeat('a2',32)),
    ('69100000-0000-4000-8001-000000001041','69100000-0000-4000-8000-000000000001','69100000-0000-4000-8000-000000000011','69100000-0000-4000-8000-000000000104','69100000-0000-4000-8000-000000000021','69100000-0000-4000-8000-000000000041','{}',repeat('33',32),repeat('a3',32)),
    ('69100000-0000-4000-8001-000000001042','69100000-0000-4000-8000-000000000001','69100000-0000-4000-8000-000000000011','69100000-0000-4000-8000-000000000104','69100000-0000-4000-8000-000000000021','69100000-0000-4000-8000-000000000041','{}',repeat('34',32),repeat('a4',32)),
    ('69100000-0000-4000-8001-000000001051','69100000-0000-4000-8000-000000000001','69100000-0000-4000-8000-000000000011','69100000-0000-4000-8000-000000000105','69100000-0000-4000-8000-000000000021','69100000-0000-4000-8000-000000000041','{}',repeat('35',32),repeat('a5',32)),
    ('69100000-0000-4000-8001-000000001061','69100000-0000-4000-8000-000000000001','69100000-0000-4000-8000-000000000011','69100000-0000-4000-8000-000000000106','69100000-0000-4000-8000-000000000021','69100000-0000-4000-8000-000000000041','{}',repeat('36',32),repeat('a6',32));
$setup$);

create temporary table insert_opposite(result jsonb);
insert into insert_opposite select pg_temp.run_opposite_population_mutations(
  'insert',
  $q$with changed as(insert into public.tryout_registrations(id,organization_id,tryout_id,athlete_id,division_id,registration_form_version_id,responses,submission_key_digest,submission_digest) values('69100000-0000-4000-8002-000000001011','69100000-0000-4000-8000-000000000001','69100000-0000-4000-8000-000000000011','69100000-0000-4000-8000-000000000101','69100000-0000-4000-8000-000000000021','69100000-0000-4000-8000-000000000041','{}',repeat('41',32),repeat('b1',32)) returning 1) select count(*)::text from changed$q$,
  $q$with changed as(insert into public.tryout_registrations(id,organization_id,tryout_id,athlete_id,division_id,registration_form_version_id,responses,submission_key_digest,submission_digest) values('69100000-0000-4000-8002-000000001012','69100000-0000-4000-8000-000000000001','69100000-0000-4000-8000-000000000011','69100000-0000-4000-8000-000000000102','69100000-0000-4000-8000-000000000021','69100000-0000-4000-8000-000000000041','{}',repeat('42',32),repeat('b2',32)) returning 1) select count(*)::text from changed$q$,
  $q$with changed as(insert into public.tryout_registrations(id,organization_id,tryout_id,athlete_id,division_id,registration_form_version_id,responses,submission_key_digest,submission_digest) values('69100000-0000-4000-8002-000000001021','69100000-0000-4000-8000-000000000001','69100000-0000-4000-8000-000000000011','69100000-0000-4000-8000-000000000102','69100000-0000-4000-8000-000000000021','69100000-0000-4000-8000-000000000041','{}',repeat('43',32),repeat('b3',32)) returning 1) select count(*)::text from changed$q$,
  $q$with changed as(insert into public.tryout_registrations(id,organization_id,tryout_id,athlete_id,division_id,registration_form_version_id,responses,submission_key_digest,submission_digest) values('69100000-0000-4000-8002-000000001022','69100000-0000-4000-8000-000000000001','69100000-0000-4000-8000-000000000011','69100000-0000-4000-8000-000000000101','69100000-0000-4000-8000-000000000021','69100000-0000-4000-8000-000000000041','{}',repeat('44',32),repeat('b4',32)) returning 1) select count(*)::text from changed$q$
);
select is((select result->>'bBlockedBeforePerKeyLock' from insert_opposite),'true',
  'A->B versus B->A inserts serialize before either transaction owns opposite keys');
select is((select result->>'aError' from insert_opposite),'OK',
  'A->B insert transaction commits without deadlock or retry');
select is((select result->>'bError' from insert_opposite),'OK',
  'B->A insert transaction commits without deadlock or retry');

create temporary table delete_opposite(result jsonb);
insert into delete_opposite select pg_temp.run_opposite_population_mutations(
  'delete',
  $q$with changed as(delete from public.tryout_registrations where id='69100000-0000-4000-8001-000000001031' returning 1) select count(*)::text from changed$q$,
  $q$with changed as(delete from public.tryout_registrations where id='69100000-0000-4000-8001-000000001041' returning 1) select count(*)::text from changed$q$,
  $q$with changed as(delete from public.tryout_registrations where id='69100000-0000-4000-8001-000000001042' returning 1) select count(*)::text from changed$q$,
  $q$with changed as(delete from public.tryout_registrations where id='69100000-0000-4000-8001-000000001032' returning 1) select count(*)::text from changed$q$,
  true
);
select is((select result->>'bBlockedBeforePerKeyLock' from delete_opposite),'true',
  'replica-role A->B versus B->A deletes serialize at the organization fence');
select is((select result->>'aError' from delete_opposite),'OK',
  'replica-role A->B delete transaction commits without retry');
select is((select result->>'bError' from delete_opposite),'OK',
  'replica-role B->A delete transaction commits without retry');

create temporary table mixed_opposite(result jsonb);
insert into mixed_opposite select pg_temp.run_opposite_population_mutations(
  'mixed',
  $q$with changed as(insert into public.tryout_registrations(id,organization_id,tryout_id,athlete_id,division_id,registration_form_version_id,responses,submission_key_digest,submission_digest) values('69100000-0000-4000-8002-000000001051','69100000-0000-4000-8000-000000000001','69100000-0000-4000-8000-000000000011','69100000-0000-4000-8000-000000000105','69100000-0000-4000-8000-000000000021','69100000-0000-4000-8000-000000000041','{}',repeat('45',32),repeat('b5',32)) returning 1) select count(*)::text from changed$q$,
  $q$with changed as(delete from public.tryout_registrations where id='69100000-0000-4000-8001-000000001061' returning 1) select count(*)::text from changed$q$,
  $q$with changed as(insert into public.tryout_registrations(id,organization_id,tryout_id,athlete_id,division_id,registration_form_version_id,responses,submission_key_digest,submission_digest) values('69100000-0000-4000-8002-000000001061','69100000-0000-4000-8000-000000000001','69100000-0000-4000-8000-000000000011','69100000-0000-4000-8000-000000000106','69100000-0000-4000-8000-000000000021','69100000-0000-4000-8000-000000000041','{}',repeat('46',32),repeat('b6',32)) returning 1) select count(*)::text from changed$q$,
  $q$with changed as(delete from public.tryout_registrations where id='69100000-0000-4000-8001-000000001051' returning 1) select count(*)::text from changed$q$
);
select is((select result->>'bBlockedBeforePerKeyLock' from mixed_opposite),'true',
  'opposite-order delete plus insert work serializes before per-key maintenance');
select is((select result->>'aError' from mixed_opposite),'OK',
  'the first mixed transaction commits without deadlock or retry');
select is((select result->>'bError' from mixed_opposite),'OK',
  'the opposite mixed transaction commits without deadlock or retry');

create temporary table rollback_release(result jsonb);
insert into rollback_release select pg_temp.run_blocked_then_release(
  'rollback',
  $q$with changed as(insert into public.tryout_registrations(id,organization_id,tryout_id,athlete_id,division_id,registration_form_version_id,responses,submission_key_digest,submission_digest) values('69100000-0000-4000-8002-000000001071','69100000-0000-4000-8000-000000000001','69100000-0000-4000-8000-000000000011','69100000-0000-4000-8000-000000000107','69100000-0000-4000-8000-000000000021','69100000-0000-4000-8000-000000000041','{}',repeat('47',32),repeat('b7',32)) returning 1) select count(*)::text from changed$q$,
  $q$with changed as(insert into public.tryout_registrations(id,organization_id,tryout_id,athlete_id,division_id,registration_form_version_id,responses,submission_key_digest,submission_digest) values('69100000-0000-4000-8002-000000001081','69100000-0000-4000-8000-000000000001','69100000-0000-4000-8000-000000000011','69100000-0000-4000-8000-000000000108','69100000-0000-4000-8000-000000000021','69100000-0000-4000-8000-000000000041','{}',repeat('48',32),repeat('b8',32)) returning 1) select count(*)::text from changed$q$,
  true
);
select is((select result->>'bBlocked' from rollback_release),'true',
  'same-organization maintenance waits for the first transaction outcome');
select is((select result->>'bError' from rollback_release),'OK',
  'a waiting registration completes after the fence holder rolls back');
select is((select count(*) from public.tryout_registrations
  where id='69100000-0000-4000-8002-000000001071'),0::bigint,
  'rollback removes the first registration and its population increment');

create temporary table same_key_release(result jsonb);
insert into same_key_release select pg_temp.run_blocked_then_release(
  'samekey',
  $q$with changed as(insert into public.tryout_registrations(id,organization_id,tryout_id,athlete_id,division_id,registration_form_version_id,responses,submission_key_digest,submission_digest) values('69100000-0000-4000-8002-000000001091','69100000-0000-4000-8000-000000000001','69100000-0000-4000-8000-000000000011','69100000-0000-4000-8000-000000000109','69100000-0000-4000-8000-000000000021','69100000-0000-4000-8000-000000000041','{}',repeat('49',32),repeat('b9',32)) returning 1) select count(*)::text from changed$q$,
  $q$with changed as(insert into public.tryout_registrations(id,organization_id,tryout_id,athlete_id,division_id,registration_form_version_id,responses,submission_key_digest,submission_digest) values('69100000-0000-4000-8002-000000001092','69100000-0000-4000-8000-000000000001','69100000-0000-4000-8000-000000000011','69100000-0000-4000-8000-000000000109','69100000-0000-4000-8000-000000000021','69100000-0000-4000-8000-000000000041','{}',repeat('4a',32),repeat('ba',32)) returning 1) select count(*)::text from changed$q$,
  false
);
select is((select result->>'bBlocked' from same_key_release),'true',
  'concurrent same-key registrations serialize on the organization fence');
select is((select result->>'bError' from same_key_release),'OK',
  'both same-key registrations commit without a client retry');
select is((select registration_count from private.report_tryout_athlete_population
  where organization_id='69100000-0000-4000-8000-000000000001'
    and tryout_id='69100000-0000-4000-8000-000000000011'
    and athlete_id='69100000-0000-4000-8000-000000000109'),2::bigint,
  'same-key population count matches its two committed registrations');

-- Hold the primary organization's fence open.  The second organization must
-- still commit while the first transaction is unfinished.
select extensions.dblink_connect('r69_cross_a',
  pg_temp.dblink_connection_string('report-fence-cross-a'));
select extensions.dblink_connect('r69_cross_b',
  pg_temp.dblink_connection_string('report-fence-cross-b'));
select extensions.dblink_exec('r69_cross_a','begin');
select * from extensions.dblink('r69_cross_a',$q$
  with changed as(insert into public.tryout_registrations(id,organization_id,tryout_id,athlete_id,division_id,registration_form_version_id,responses,submission_key_digest,submission_digest) values('69100000-0000-4000-8002-000000001101','69100000-0000-4000-8000-000000000001','69100000-0000-4000-8000-000000000011','69100000-0000-4000-8000-000000000108','69100000-0000-4000-8000-000000000021','69100000-0000-4000-8000-000000000041','{}',repeat('4b',32),repeat('bb',32)) returning 1) select count(*)::text from changed
$q$) as response(result text);
select extensions.dblink_send_query('r69_cross_b',$q$
  with changed as(insert into public.tryout_registrations(id,organization_id,tryout_id,athlete_id,division_id,registration_form_version_id,responses,submission_key_digest,submission_digest) values('69200000-0000-4000-8002-000000002011','69200000-0000-4000-8000-000000000001','69200000-0000-4000-8000-000000000011','69200000-0000-4000-8000-000000000201','69200000-0000-4000-8000-000000000021','69200000-0000-4000-8000-000000000041','{}',repeat('4c',32),repeat('bc',32)) returning 1) select count(*)::text from changed
$q$);
select pg_temp.wait_for_dblink('r69_cross_b');
select is(extensions.dblink_error_message('r69_cross_b'),'OK',
  'a different organization completes while the first organization fence is held');
select * from extensions.dblink_get_result('r69_cross_b',false) as response(result text);
select * from extensions.dblink_get_result('r69_cross_b',false) as response(result text);
select extensions.dblink_exec('r69_cross_a','commit');
select extensions.dblink_disconnect('r69_cross_a');
select extensions.dblink_disconnect('r69_cross_b');

select is((select count(*) from (
  select coalesce(population.organization_id,history.organization_id) organization_id,
    coalesce(population.tryout_id,history.tryout_id) tryout_id,
    coalesce(population.athlete_id,history.athlete_id) athlete_id,
    population.registration_count,history.registration_count history_count
  from private.report_tryout_athlete_population population
  full join (
    select organization_id,tryout_id,athlete_id,count(*) registration_count
    from public.tryout_registrations
    where organization_id in(
      '69100000-0000-4000-8000-000000000001',
      '69200000-0000-4000-8000-000000000001'
    ) group by organization_id,tryout_id,athlete_id
  ) history using(organization_id,tryout_id,athlete_id)
  where coalesce(population.organization_id,history.organization_id) in(
      '69100000-0000-4000-8000-000000000001',
      '69200000-0000-4000-8000-000000000001'
    ) and population.registration_count is distinct from history.registration_count
) drift),0::bigint,
  'insert, delete, mixed, rollback, same-key, and cross-org commits leave no population drift');

-- Explicit cleanup is required because dblink sessions committed independently
-- from this pgTAP transaction.
select extensions.dblink_exec('r69_setup',$cleanup$
  delete from public.tryout_registrations where organization_id in(
    '69100000-0000-4000-8000-000000000001','69200000-0000-4000-8000-000000000001');
  delete from public.registration_form_versions where organization_id in(
    '69100000-0000-4000-8000-000000000001','69200000-0000-4000-8000-000000000001');
  delete from public.registration_forms where organization_id in(
    '69100000-0000-4000-8000-000000000001','69200000-0000-4000-8000-000000000001');
  delete from public.tryout_divisions where organization_id in(
    '69100000-0000-4000-8000-000000000001','69200000-0000-4000-8000-000000000001');
  delete from public.tryouts where organization_id in(
    '69100000-0000-4000-8000-000000000001','69200000-0000-4000-8000-000000000001');
  delete from public.athletes where organization_id in(
    '69100000-0000-4000-8000-000000000001','69200000-0000-4000-8000-000000000001');
  delete from public.organizations where id in(
    '69100000-0000-4000-8000-000000000001','69200000-0000-4000-8000-000000000001');
$cleanup$);
select extensions.dblink_disconnect('r69_setup');

select * from finish();
rollback;
