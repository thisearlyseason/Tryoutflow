begin;
select plan(56);

select has_table('public','integration_connections','durable integration connections exist');
select has_table('public','integration_export_previews','durable export previews exist');
select has_table('public','integration_sync_jobs','durable integration jobs exist');
select has_table('public','integration_sync_items','durable integration job items exist');
select has_table('public','external_entity_mappings','durable external mappings exist');
select has_table('public','integration_outbox_jobs','durable integration outbox exists');

select col_is_pk('public','integration_connections','id','connections have stable IDs');
select col_is_pk('public','integration_sync_jobs','id','sync jobs have stable IDs');
select col_is_pk('public','integration_outbox_jobs','id','outbox jobs have stable IDs');
select has_index('public','integration_connections','integration_connections_actor_provider_key','one actor/provider connection is stable per tenant');
select has_index('public','integration_sync_jobs','integration_sync_jobs_idempotency_key','top-level export idempotency is tenant and connection scoped');
select has_index('public','external_entity_mappings','external_entity_mappings_internal_key','one stable external mapping exists per internal entity');
select has_index('public','external_entity_mappings','external_entity_mappings_external_key','one external entity cannot map to duplicate internal entities');
select has_index('public','integration_outbox_jobs','integration_outbox_jobs_claim_idx','integration outbox has a bounded claim index');

select has_function('public','save_integration_connection',array['uuid','text','uuid','text','boolean']);
select has_function('public','load_roster_export_context',array['uuid','uuid','uuid']);
select has_function('public','save_roster_export_preview',array['uuid','uuid','uuid','jsonb','text[]','text','text','text','jsonb','text']);
select has_function('public','confirm_roster_export_preview',array['uuid','text','text','text']);
select has_function('public','retry_integration_sync_job',array['uuid','uuid','text']);
select has_function('public','claim_integration_outbox_jobs',array['text','integer','integer']);
select has_function('public','authorize_integration_outbox_submission',array['uuid','uuid','bigint']);
select has_function('public','complete_integration_outbox_job',array['uuid','uuid','bigint','text','jsonb']);
select has_function('public','fail_integration_outbox_job',array['uuid','uuid','bigint','text','boolean']);

select ok(not has_table_privilege('authenticated','public.integration_connections','insert'),'authenticated callers cannot forge connections');
select ok(not has_table_privilege('authenticated','public.integration_sync_jobs','update'),'authenticated callers cannot forge job state');
select ok(not has_table_privilege('authenticated','public.integration_sync_items','update'),'authenticated callers cannot overwrite completed items');
select ok(not has_table_privilege('authenticated','public.external_entity_mappings','insert'),'authenticated callers cannot forge mappings');
select ok(not has_table_privilege('authenticated','public.integration_outbox_jobs','insert'),'authenticated callers cannot forge outbox work');
select ok(not has_function_privilege('authenticated','public.claim_integration_outbox_jobs(text,integer,integer)','execute'),'authenticated callers cannot claim integration work');
select ok(has_function_privilege('service_role','public.claim_integration_outbox_jobs(text,integer,integer)','execute'),'service workers can claim integration work');
select ok(not has_function_privilege('anon','public.save_integration_connection(uuid,text,uuid,text,boolean)','execute'),'anonymous callers cannot persist connections');
select ok(not has_function_privilege('anon','public.confirm_roster_export_preview(uuid,text,text,text)','execute'),'anonymous callers cannot confirm exports');

select has_column('public','integration_connections','organization_id','connections carry tenant scope');
select has_column('public','integration_export_previews','organization_id','previews carry tenant scope');
select has_column('public','integration_sync_jobs','organization_id','sync jobs carry tenant scope');
select has_column('public','integration_sync_items','organization_id','sync items carry tenant scope');
select has_column('public','external_entity_mappings','organization_id','mappings carry tenant scope');
select has_column('public','integration_outbox_jobs','organization_id','outbox jobs carry tenant scope');

select ok((select relrowsecurity from pg_class where oid='public.integration_connections'::regclass),'connections enforce RLS');
select ok((select relrowsecurity from pg_class where oid='public.integration_export_previews'::regclass),'previews enforce RLS');
select ok((select relrowsecurity from pg_class where oid='public.integration_sync_jobs'::regclass),'sync jobs enforce RLS');
select ok((select relrowsecurity from pg_class where oid='public.integration_sync_items'::regclass),'sync items enforce RLS');
select ok((select relrowsecurity from pg_class where oid='public.external_entity_mappings'::regclass),'mappings enforce RLS');
select ok((select relrowsecurity from pg_class where oid='public.integration_outbox_jobs'::regclass),'outbox jobs enforce RLS');

insert into auth.users(id) values
  ('59000000-0000-4000-8000-000000000001'),
  ('59000000-0000-4000-8000-000000000002');
insert into public.organizations(id,name,slug) values
  ('59100000-0000-4000-8000-000000000001','Integration tenant A','integration-tenant-a'),
  ('59100000-0000-4000-8000-000000000002','Integration tenant B','integration-tenant-b');
insert into public.organization_members(organization_id,user_id,role,status) values
  ('59100000-0000-4000-8000-000000000001','59000000-0000-4000-8000-000000000001','owner','active'),
  ('59100000-0000-4000-8000-000000000002','59000000-0000-4000-8000-000000000002','owner','active');
insert into public.tryouts(id,organization_id,name,slug,sport,timezone) values
  ('59200000-0000-4000-8000-000000000001','59100000-0000-4000-8000-000000000001','Integration Tryout','integration-tryout','Hockey','America/Edmonton');
insert into public.tryout_divisions(id,organization_id,tryout_id,name,sort_order) values
  ('59300000-0000-4000-8000-000000000001','59100000-0000-4000-8000-000000000001','59200000-0000-4000-8000-000000000001','U18',0);
insert into public.roster_versions(
  id,organization_id,tryout_id,division_id,revision_number,state,version,
  finalized_by_user_id,finalized_at,created_by_user_id
) values (
  '59400000-0000-4000-8000-000000000001','59100000-0000-4000-8000-000000000001',
  '59200000-0000-4000-8000-000000000001','59300000-0000-4000-8000-000000000001',
  1,'finalized',1,'59000000-0000-4000-8000-000000000001',clock_timestamp(),
  '59000000-0000-4000-8000-000000000001'
);
insert into public.integration_connections(
  id,organization_id,provider_key,display_name,state,mock_data,created_by_user_id
) values (
  '59500000-0000-4000-8000-000000000001','59100000-0000-4000-8000-000000000001',
  'the-squad','The Squad (demo/mock)','connected',true,'59000000-0000-4000-8000-000000000001'
);
insert into public.integration_export_previews(
  id,organization_id,connection_id,roster_version_id,roster_version,created_by_user_id,
  provider_preview_id,provider_confirmation_token,provider_snapshot_digest,payload_digest,
  destination_snapshot,approved_fields,roster_snapshot,preview_snapshot
) values (
  '59600000-0000-4000-8000-000000000001','59100000-0000-4000-8000-000000000001',
  '59500000-0000-4000-8000-000000000001','59400000-0000-4000-8000-000000000001',1,
  '59000000-0000-4000-8000-000000000001','preview:tenant-safe-0001','confirmation:tenant-safe-0001',
  repeat('a',64),repeat('b',64),'{}'::jsonb,array['first_name'],
  '{"athletes":[]}'::jsonb,'{"items":[]}'::jsonb
);
insert into public.integration_sync_jobs(
  id,organization_id,connection_id,provider_key,business_idempotency_key,request_digest,
  roster_version_id,roster_version,destination_snapshot,approved_fields,roster_snapshot,
  provider_preview_id,provider_confirmation_token,state,mock_data,created_by_user_id
) values (
  '59700000-0000-4000-8000-000000000001','59100000-0000-4000-8000-000000000001',
  '59500000-0000-4000-8000-000000000001','the-squad','export:tenant-safe-0001',repeat('c',64),
  '59400000-0000-4000-8000-000000000001',1,'{}'::jsonb,array['first_name'],'{"athletes":[]}'::jsonb,
  'preview:tenant-safe-0002','confirmation:tenant-safe-0002','pending',true,
  '59000000-0000-4000-8000-000000000001'
);
insert into public.integration_sync_items(
  id,organization_id,sync_job_id,item_key,entity_type,internal_entity_id,operation,state
) values (
  '59800000-0000-4000-8000-000000000001','59100000-0000-4000-8000-000000000001',
  '59700000-0000-4000-8000-000000000001','athlete:59800000-0000-4000-8000-000000000002',
  'athlete','59800000-0000-4000-8000-000000000002','create','pending'
);
insert into public.external_entity_mappings(
  id,organization_id,connection_id,provider_key,entity_type,internal_entity_id,external_id,
  external_ref,first_sync_job_id,last_sync_job_id
) values (
  '59900000-0000-4000-8000-000000000001','59100000-0000-4000-8000-000000000001',
  '59500000-0000-4000-8000-000000000001','the-squad','athlete',
  '59800000-0000-4000-8000-000000000002','mock-athlete-tenant-safe',
  '{"externalId":"mock-athlete-tenant-safe"}'::jsonb,
  '59700000-0000-4000-8000-000000000001','59700000-0000-4000-8000-000000000001'
);
insert into public.integration_outbox_jobs(
  id,organization_id,sync_job_id,attempt_number,retry_idempotency_key,
  provider_idempotency_key,item_keys
) values (
  '59900000-0000-4000-8000-000000000002','59100000-0000-4000-8000-000000000001',
  '59700000-0000-4000-8000-000000000001',1,'retry:tenant-safe-0001',
  'integration:59700000-0000-4000-8000-000000000001:1',
  array['athlete:59800000-0000-4000-8000-000000000002']
);

select throws_ok(
  $$insert into public.integration_sync_items(organization_id,sync_job_id,item_key,entity_type,internal_entity_id,operation,state)
    values('59100000-0000-4000-8000-000000000002','59700000-0000-4000-8000-000000000001',
    'athlete:59800000-0000-4000-8000-000000000003','athlete','59800000-0000-4000-8000-000000000003','create','pending')$$,
  '23503',null,'composite tenant foreign keys reject cross-tenant item attachment'
);
select ok(not has_table_privilege('authenticated','public.integration_outbox_jobs','select'),'authenticated callers cannot read worker leases');

set local role authenticated;
select set_config('request.jwt.claim.sub','59000000-0000-4000-8000-000000000001',true);
select is((select count(*) from public.integration_connections),1::bigint,'tenant owner can read its integration connection');
select throws_ok(
  $$select count(*) from public.integration_export_previews$$,
  '42501','permission denied for table integration_export_previews',
  'preview creators cannot bypass the actor-authorized preview RPC'
);
select is((select count(*) from public.integration_sync_jobs),1::bigint,'tenant owner can read its sync job');
select is((select count(*) from public.integration_sync_items),1::bigint,'tenant owner can read its sync items');
select is((select count(*) from public.external_entity_mappings),1::bigint,'tenant owner can read its mappings');

select set_config('request.jwt.claim.sub','59000000-0000-4000-8000-000000000002',true);
select is((select count(*) from public.integration_connections),0::bigint,'another tenant cannot read connections');
select throws_ok(
  $$select count(*) from public.integration_export_previews$$,
  '42501','permission denied for table integration_export_previews',
  'other tenants cannot read private preview sources'
);
select is((select count(*) from public.integration_sync_jobs),0::bigint,'another tenant cannot read sync jobs');
select is((select count(*) from public.integration_sync_items),0::bigint,'another tenant cannot read sync items');
select is((select count(*) from public.external_entity_mappings),0::bigint,'another tenant cannot read mappings');
reset role;

select * from finish();
rollback;
