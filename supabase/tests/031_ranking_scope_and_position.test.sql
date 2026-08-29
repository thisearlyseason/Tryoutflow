begin;
select plan(9);

select has_function('public','public_registration_tryout_v2',array['text'],'public registration exposes bounded position metadata');
select has_function('public','submit_public_registration_with_position',array['text','jsonb','text','text','uuid'],'public registration persists a normalized position');
select ok(has_function_privilege('anon','public.public_registration_tryout_v2(text)','execute'),'anonymous may read published registration metadata');
select ok(not has_function_privilege('anon','public.submit_public_registration_with_position(text,jsonb,text,text,uuid)','execute'),'anonymous cannot bypass the guarded HTTP registration service');
select ok(has_function_privilege('service_role','public.submit_public_registration_with_position(text,jsonb,text,text,uuid)','execute'),'service role may execute the guarded position-aware command');
select ok(not has_function_privilege('service_role','public.load_ranking_snapshot(uuid,uuid,uuid,uuid,uuid,uuid,uuid[])','execute'),'service role still cannot bypass ranking scope');
select matches(pg_get_functiondef('public.load_live_dashboard(uuid,uuid,uuid,uuid,uuid)'::regprocedure),'recordedSyncExceptions','live projection names historical sync receipts truthfully');
select ok(position('syncNeedsAttention' in pg_get_functiondef('public.load_live_dashboard(uuid,uuid,uuid,uuid,uuid)'::regprocedure))=0,'misleading current sync metric name is absent');
select is((select prosecdef from pg_proc where oid='public.load_ranking_snapshot(uuid,uuid,uuid,uuid,uuid,uuid,uuid[])'::regprocedure),true,'ranking projection retains its guarded security-definer boundary');

select * from finish();
rollback;
