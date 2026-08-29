begin;
select plan(8);

select has_column('public','tryout_registrations','position_id','registrations can carry a normalized tryout position');
select has_function('public','load_ranking_snapshot',array['uuid','uuid','uuid','uuid','uuid','uuid','uuid[]'],'ranking snapshot RPC exists');
select has_function('public','load_live_dashboard',array['uuid','uuid','uuid','uuid','uuid'],'live dashboard RPC exists');
select ok(has_function_privilege('authenticated','public.load_ranking_snapshot(uuid,uuid,uuid,uuid,uuid,uuid,uuid[])','execute'),'authenticated may invoke the guarded rankings RPC');
select ok(not has_function_privilege('anon','public.load_ranking_snapshot(uuid,uuid,uuid,uuid,uuid,uuid,uuid[])','execute'),'anonymous cannot invoke rankings');
select ok(not has_function_privilege('service_role','public.load_ranking_snapshot(uuid,uuid,uuid,uuid,uuid,uuid,uuid[])','execute'),'service role cannot bypass ranking authorization');
select ok(not has_function_privilege('authenticated','private.ranking_assignment_matches(uuid,uuid,uuid,uuid,uuid,uuid,uuid,text)','execute'),'scope helper is not an exposed RPC');
select ok(not has_table_privilege('service_role','public.evaluation_notes','select'),'ranking access does not grant service-role note reads');

select * from finish();
rollback;
