begin;
select plan(38);

select has_type('public','integration_export_confirmation_v4_result','confirmation v4 exposes one strict durable projection');
select has_function('public','confirm_roster_export_preview_v4',array['uuid','text','text','text','text']);
select is(
  (select proconfig from pg_proc where oid=to_regprocedure('public.confirm_roster_export_preview_v4(uuid,text,text,text,text)')),
  array['search_path=""']::text[],
  'confirmation v4 uses an empty search path'
);
select ok(
  coalesce(has_function_privilege('authenticated',to_regprocedure('public.confirm_roster_export_preview_v4(uuid,text,text,text,text)'),'execute'),false),
  'authenticated owners use only the strict v4 confirmation boundary'
);
select ok(
  not coalesce(has_function_privilege('anon',to_regprocedure('public.confirm_roster_export_preview_v4(uuid,text,text,text,text)'),'execute'),false),
  'anonymous callers cannot confirm through v4'
);
select ok(
  not coalesce(has_function_privilege('service_role',to_regprocedure('public.confirm_roster_export_preview_v4(uuid,text,text,text,text)'),'execute'),false),
  'service workers do not bypass the authenticated confirmation boundary'
);
select is(
  (select coalesce(array_agg(proname order by proname),'{}'::name[])
   from pg_proc
   where pronamespace='public'::regnamespace
     and proname like 'confirm_roster_export_preview%'
     and has_function_privilege('authenticated',oid,'execute')),
  array['confirm_roster_export_preview_v4']::name[],
  'v4 is the sole authenticated confirmation boundary'
);
select ok(not has_function_privilege('authenticated','public.confirm_roster_export_preview(uuid,text,text,text)','execute'),'v1 confirmation remains retired');
select ok(not has_function_privilege('authenticated','public.confirm_roster_export_preview_v2(uuid,text,text,text)','execute'),'v2 confirmation bypass is retired');
select ok(not has_function_privilege('authenticated','public.confirm_roster_export_preview_v3(uuid,text,text,text)','execute'),'post-mutation v3 confirmation is retired');
select ok(not has_function_privilege('anon','public.confirm_roster_export_preview_v2(uuid,text,text,text)','execute'),'anonymous callers cannot use v2');
select ok(not has_function_privilege('service_role','public.confirm_roster_export_preview_v2(uuid,text,text,text)','execute'),'service workers cannot use v2');

select has_function('private','redact_integration_sync_payload',array['uuid']);
select ok(
  not has_function_privilege('authenticated',to_regprocedure('private.redact_integration_sync_payload(uuid)'),'execute'),
  'authenticated callers cannot invoke the payload redactor'
);
select ok(
  exists(select 1 from pg_constraint where conrelid='public.integration_export_previews'::regclass and conname='integration_export_previews_stage_shape_check'),
  'preview lifecycle has an explicit shape constraint'
);
select ok(
  position('PREVIEW_SNAPSHOT IS NULL' in upper(pg_get_constraintdef((
    select oid from pg_constraint
    where conrelid='public.integration_export_previews'::regclass
      and conname='integration_export_previews_stage_shape_check'
  ))))>0,
  'redacted preview shape is defined by cleared provider preview bytes'
);
select ok(
  exists(select 1 from pg_constraint where conrelid='public.integration_sync_jobs'::regclass and conname='integration_sync_jobs_legacy_payload_check'),
  'legacy sync-job payload columns are constrained empty'
);
select ok(
  not exists(select 1 from public.integration_export_previews where stage='redacted' and (
    provider_confirmation_token is not null or roster_snapshot<>'{}'::jsonb or preview_snapshot is not null
  )),
  'all redacted previews have sensitive columns cleared regardless of their prior stage'
);
select ok(
  not exists(select 1 from public.integration_sync_jobs where roster_snapshot is not null or provider_confirmation_token is not null),
  'legacy sync-job roster and provider-token columns are empty after upgrade repair'
);

set local session_replication_role=replica;
insert into public.integration_sync_jobs(
  id,organization_id,connection_id,provider_key,business_idempotency_key,request_digest,
  roster_version_id,roster_version,destination_snapshot,approved_fields,roster_snapshot,
  provider_preview_id,provider_confirmation_token,state,mock_data,created_by_user_id,
  source_preview_id,approved_projection,confirmation_token_digest
) values(
  '63000000-0000-4000-8000-000000000010','63000000-0000-4000-8000-000000000011',
  '63000000-0000-4000-8000-000000000012','the-squad','export:round4:repair:01',repeat('a',64),
  '63000000-0000-4000-8000-000000000013',1,'{}'::jsonb,array['first_name'],null,
  'preview:round4:repair:01',null,'failed',true,'63000000-0000-4000-8000-000000000014',
  '63000000-0000-4000-8000-000000000015',
  '[{"itemKey":"athlete:63000000-0000-4000-8000-000000000016","displayLabel":"Historical Private Athlete"}]'::jsonb,
  repeat('b',64)
);
insert into public.integration_export_previews(
  id,organization_id,connection_id,roster_version_id,roster_version,created_by_user_id,
  provider_preview_id,provider_confirmation_token,provider_snapshot_digest,payload_digest,
  destination_snapshot,approved_fields,roster_snapshot,preview_snapshot,expires_at,consumed_at,
  sync_job_id,source_digest,stage,redacted_at,existing_athlete_ids
) values(
  '63000000-0000-4000-8000-000000000015','63000000-0000-4000-8000-000000000011',
  '63000000-0000-4000-8000-000000000012','63000000-0000-4000-8000-000000000013',1,
  '63000000-0000-4000-8000-000000000014','preview:round4:repair:01',null,repeat('c',64),repeat('a',64),
  '{}'::jsonb,array['first_name'],'{}'::jsonb,null,clock_timestamp()+interval '1 day',clock_timestamp(),
  '63000000-0000-4000-8000-000000000010',repeat('a',64),'redacted',clock_timestamp(),'{}'::uuid[]
);
select is(
  private.repair_integration_sensitive_history(10),
  1,
  'bounded history repair revisits a redacted preview whose failed job still retains a sensitive projection'
);
select is(
  (select approved_projection from public.integration_sync_jobs where id='63000000-0000-4000-8000-000000000010'),
  '[]'::jsonb,
  'history repair clears the retained failed-job projection bytes'
);
reset session_replication_role;

set local session_replication_role=replica;
select throws_ok($sql$
  insert into public.integration_export_previews(
    id,organization_id,connection_id,roster_version_id,roster_version,created_by_user_id,
    provider_preview_id,provider_confirmation_token,provider_snapshot_digest,payload_digest,
    destination_snapshot,approved_fields,roster_snapshot,preview_snapshot,expires_at,
    source_digest,stage,redacted_at,existing_athlete_ids
  ) values(
    '63000000-0000-4000-8000-000000000001','63000000-0000-4000-8000-000000000002',
    '63000000-0000-4000-8000-000000000003','63000000-0000-4000-8000-000000000004',1,
    '63000000-0000-4000-8000-000000000005','preview:round4:redacted:01',null,repeat('a',64),repeat('b',64),
    '{}'::jsonb,array['first_name'],'{}'::jsonb,
    '{"confirmationToken":"confirmation:round4:leak","items":[{"displayLabel":"Private Athlete","fields":{"email":"private@example.test"}}]}'::jsonb,
    clock_timestamp()+interval '1 day',repeat('b',64),'redacted',clock_timestamp(),'{}'::uuid[]
  )
$sql$,'23514',null,'a row cannot claim redaction while retaining provider preview PII or token bytes');
reset session_replication_role;

select has_function('private','repair_integration_sensitive_history',array['integer']);
select ok(
  not has_function_privilege('authenticated',to_regprocedure('private.repair_integration_sensitive_history(integer)'),'execute'),
  'history repair is private'
);
select has_type('public','integration_retry_v4_result','retry v4 exposes every job-bound durable projection');
select has_function('public','retry_integration_sync_job_v4',array['uuid','uuid','text']);
select ok(
  coalesce(has_function_privilege('authenticated',to_regprocedure('public.retry_integration_sync_job_v4(uuid,uuid,text)'),'execute'),false),
  'authenticated owners use retry v4'
);
select ok(not has_function_privilege('authenticated','public.retry_integration_sync_job_v3(uuid,uuid,text)','execute'),'retry v3 is retired from runtime callers');
select is(
  (select array_agg(attribute_name order by ordinal_position)::text[]
   from information_schema.attributes
   where udt_schema='public' and udt_name='integration_retry_v4_result'),
  array[
    'outcome','job_id','state','retried_item_count','preserved_completed_item_count',
    'preserved_skipped_item_count','completed_count','skipped_count','failed_count','retry_eligible_count'
  ]::text[],
  'retry v4 result includes exact state and every durable count'
);

select has_function('private','lock_integration_sync_job',array['uuid']);
select ok(not has_function_privilege('authenticated',to_regprocedure('private.lock_integration_sync_job(uuid)'),'execute'),'stable sync serialization key is private');
select ok(
  position('lock_integration_sync_job' in pg_get_functiondef('public.claim_integration_outbox_jobs(text,integer,integer)'::regprocedure))>0,
  'claim uses the stable per-sync serialization key'
);
select ok(
  position('lock_integration_sync_job' in pg_get_functiondef('public.purge_expired_integration_previews(integer)'::regprocedure))>0,
  'purge uses the stable per-sync serialization key'
);
select ok(
  position('lock_integration_sync_job' in pg_get_functiondef(to_regprocedure('public.retry_integration_sync_job_v4(uuid,uuid,text)')))>0,
  'retry uses the stable per-sync serialization key'
);
select ok(
  position('lock_integration_sync_job' in pg_get_functiondef('private.check_integration_outbox_execution(uuid,uuid,bigint,boolean)'::regprocedure))>0,
  'validation and authorization use the stable per-sync serialization key'
);
select ok(
  position('lock_integration_sync_job' in pg_get_functiondef('public.complete_integration_outbox_job(uuid,uuid,bigint,text,jsonb)'::regprocedure))>0,
  'completion uses the stable per-sync serialization key'
);
select ok(
  position('lock_integration_sync_job' in pg_get_functiondef('public.fail_integration_outbox_job(uuid,uuid,bigint,text,boolean)'::regprocedure))>0,
  'failure uses the stable per-sync serialization key'
);
select ok(
  position('lease_expires_at>clock_timestamp()' in replace(pg_get_functiondef(to_regprocedure('private.repair_integration_sensitive_history(integer)')),' ',''))>0,
  'upgrade history repair explicitly preserves active unexpired leases'
);

select * from finish();
rollback;
