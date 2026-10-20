begin;
select plan(25);

select has_column('public','integration_export_previews','existing_athlete_ids','immutable sources persist mapping state used by preview CAS');
select has_column('public','integration_outbox_jobs','completion_result_digest','completion replay binds the exact provider result without retaining raw PII');
select has_trigger('public','integration_export_previews','cap_integration_preview_expiry','preview retention is capped by a database trigger');
select has_function('public','confirm_roster_export_preview_v3',array['uuid','text','text','text']);
select is((select proconfig from pg_proc where oid='public.confirm_roster_export_preview_v3(uuid,text,text,text)'::regprocedure),array['search_path=""']::text[],'exact confirmation summary uses an empty search path');

select ok(not has_function_privilege('authenticated','public.load_roster_export_context(uuid,uuid,uuid)','execute'),'legacy mutable roster export context is closed');
select ok(not has_function_privilege('anon','public.complete_integration_outbox_job(uuid,uuid,bigint,text,jsonb)','execute'),'anonymous callers cannot complete integration work');
select ok(not has_function_privilege('authenticated','public.complete_integration_outbox_job(uuid,uuid,bigint,text,jsonb)','execute'),'authenticated callers cannot complete integration work');
select ok(not has_function_privilege('anon','public.fail_integration_outbox_job(uuid,uuid,bigint,text,boolean)','execute'),'anonymous callers cannot fail integration work');
select ok(not has_function_privilege('authenticated','public.fail_integration_outbox_job(uuid,uuid,bigint,text,boolean)','execute'),'authenticated callers cannot fail integration work');
select ok(has_function_privilege('service_role','public.complete_integration_outbox_job(uuid,uuid,bigint,text,jsonb)','execute'),'service workers retain completion authority');
select ok(has_function_privilege('service_role','public.fail_integration_outbox_job(uuid,uuid,bigint,text,boolean)','execute'),'service workers retain failure authority');

select is((select proconfig from pg_proc where oid='public.complete_integration_outbox_job(uuid,uuid,bigint,text,jsonb)'::regprocedure),array['search_path=""']::text[],'completion uses an empty search path');
select is((select proconfig from pg_proc where oid='public.fail_integration_outbox_job(uuid,uuid,bigint,text,boolean)'::regprocedure),array['search_path=""']::text[],'failure uses an empty search path');
select is((select proconfig from pg_proc where oid='public.authorize_integration_outbox_submission(uuid,uuid,bigint)'::regprocedure),array['search_path=""']::text[],'handoff authorization uses an empty search path');
select is((select proconfig from pg_proc where oid='public.claim_integration_outbox_jobs(text,integer,integer)'::regprocedure),array['search_path=""']::text[],'claim uses an empty search path');
select is((select proconfig from pg_proc where oid='public.purge_expired_integration_previews(integer)'::regprocedure),array['search_path=""']::text[],'retention purge uses an empty search path');
select ok(not has_function_privilege('authenticated','private.check_integration_outbox_execution(uuid,uuid,bigint,boolean)','execute'),'authenticated callers cannot invoke the authorization helper');
select has_function('private','integration_item_retry_is_safe',array['text','jsonb']);
select ok(private.integration_item_retry_is_safe('failed','{"code":"provider_temporary","retryable":true}'::jsonb),'explicit temporary failure is retry eligible');
select ok(private.integration_item_retry_is_safe('failed','{"code":"rate_limited","retryable":true}'::jsonb),'explicit rate limit is retry eligible');
select ok(private.integration_item_retry_is_safe('failed','{"code":"timeout","retryable":true}'::jsonb),'explicit timeout is retry eligible');
select ok(not private.integration_item_retry_is_safe('failed','{"code":"provider_rejected","retryable":false}'::jsonb),'permanent failure is not retry eligible');
select ok(not private.integration_item_retry_is_safe('requires_review','{"code":"provider_temporary","retryable":true}'::jsonb),'ambiguous review state is not retry eligible');
select ok(not private.integration_item_retry_is_safe('failed','{"code":"delivery_uncertain","retryable":false}'::jsonb),'delivery uncertainty is not retry eligible');

select * from finish();
rollback;
