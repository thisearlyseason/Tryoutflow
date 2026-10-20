begin;
select plan(25);

select has_column('public','integration_export_previews','source_digest','previews bind a DB-issued immutable source digest');
select has_column('public','integration_export_previews','stage','preview source lifecycle is explicit');
select has_column('public','integration_sync_jobs','approved_projection','jobs retain only the approved projection');
select has_column('public','integration_sync_jobs','source_preview_id','jobs retain an exact source reference');
select has_column('public','integration_sync_jobs','confirmation_token_digest','jobs retain only a confirmation-token digest');
select has_column('public','integration_sync_items','retry_eligible','items distinguish safe provider-result retry from uncertainty');
select has_column('public','integration_outbox_jobs','job_type','outbox work has an explicit job type');
select has_column('public','integration_outbox_jobs','payload_version','outbox work has a payload version');
select has_column('public','integration_outbox_jobs','request_digest','retry attempts bind the exact request digest');

select has_function('public','issue_roster_export_source',array['uuid','uuid','uuid','jsonb','text[]']);
select has_function('public','save_roster_export_preview_v2',array['uuid','uuid','text','text','text','jsonb']);
select has_function('public','confirm_roster_export_preview_v2',array['uuid','text','text','text']);
select has_function('public','retry_integration_sync_job_v2',array['uuid','uuid','text']);
select has_function('public','purge_expired_integration_previews',array['integer']);
select has_function('public','validate_integration_outbox_execution',array['uuid','uuid','bigint']);

select ok(not has_table_privilege('authenticated','public.integration_outbox_jobs','select'),'worker payload and fencing state remain private');
select ok(not has_table_privilege('authenticated','public.integration_export_previews','select'),'raw immutable sources and short-lived confirmation tokens remain RPC-private');
select ok(not has_function_privilege('authenticated','public.authorize_integration_outbox_submission(uuid,uuid,bigint)','execute'),'callers cannot authorize provider handoff');
select ok(not has_function_privilege('authenticated','public.validate_integration_outbox_execution(uuid,uuid,bigint)','execute'),'callers cannot invoke execution validation');
select ok(has_function_privilege('service_role','public.validate_integration_outbox_execution(uuid,uuid,bigint)','execute'),'only the protected worker can validate execution state');
select ok(has_function_privilege('service_role','public.authorize_integration_outbox_submission(uuid,uuid,bigint)','execute'),'only the protected worker can authorize handoff');
select ok(not has_function_privilege('anon','public.issue_roster_export_source(uuid,uuid,uuid,jsonb,text[])','execute'),'anonymous callers cannot issue export sources');
select ok(not has_function_privilege('authenticated','public.save_roster_export_preview(uuid,uuid,uuid,jsonb,text[],text,text,text,jsonb,text)','execute'),'legacy mutable-context preview save is retired');
select ok(not has_function_privilege('authenticated','public.confirm_roster_export_preview(uuid,text,text,text)','execute'),'legacy preview-bound confirmation is retired');
select ok(not has_function_privilege('authenticated','public.retry_integration_sync_job(uuid,uuid,text)','execute'),'legacy digest-unbound retry is retired');

select * from finish();
rollback;
