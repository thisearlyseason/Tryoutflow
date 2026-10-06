begin;
create extension if not exists pgtap with schema extensions;
set local search_path=extensions,public;
select plan(20);
insert into auth.users(id,email,email_confirmed_at) values ('e1630000-0000-4000-8000-000000000001','deletion-163@example.invalid',now()),('e1630000-0000-4000-8000-000000000002','other-163@example.invalid',now()),('e1630000-0000-4000-8000-000000000003','unverified-163@example.invalid',null);
select ok(not has_table_privilege('authenticated','private.account_deletion_requests','SELECT'),'request table is private');
select ok(not has_function_privilege('anon','public.request_account_deletion(boolean)','EXECUTE'),'anonymous caller cannot request');
select is((select count(*) from unnest(array[
 'public.request_account_deletion(boolean)', 'public.get_account_deletion_request()',
 'public.platform_account_deletion_requests()', 'public.platform_update_account_deletion(uuid,boolean,boolean)',
 'public.pending_account_deletion_notices()', 'public.record_account_deletion_notice(uuid,text)'
]) as rpc(signature) where has_function_privilege('anon',signature,'EXECUTE')),0::bigint,'anonymous callers cannot execute any deletion RPC');
select is((select count(*) from unnest(array[
 'public.pending_account_deletion_notices()', 'public.record_account_deletion_notice(uuid,text)'
]) as rpc(signature) where has_function_privilege('authenticated',signature,'EXECUTE')),0::bigint,'authenticated users cannot execute notice worker RPCs');
select is((select count(*) from unnest(array[
 'public.request_account_deletion(boolean)', 'public.get_account_deletion_request()',
 'public.platform_account_deletion_requests()', 'public.platform_update_account_deletion(uuid,boolean,boolean)'
]) as rpc(signature) where has_function_privilege('service_role',signature,'EXECUTE')),0::bigint,'service role cannot execute account or administrator RPCs');
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated"}',true);
select throws_ok('select public.get_account_deletion_request()','42501','unauthorized','missing subject cannot read an account request');
select throws_ok('select public.request_account_deletion(true)','42501','unauthorized','missing subject cannot submit an account request');
select set_config('request.jwt.claims','{"sub":"e1630000-0000-4000-8000-000000000003","role":"authenticated"}',true);
select throws_ok('select public.request_account_deletion(true)','42501','verified_email_required','unverified account cannot submit a request');
select set_config('request.jwt.claims','{"sub":"e1630000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select throws_ok('select public.request_account_deletion(false)','22023','confirmation_required','explicit confirmation required');
select is(public.get_account_deletion_request(),null::jsonb,'initially no request');
select is(public.request_account_deletion(true)->>'status','requested','request saved');
select is(public.request_account_deletion(true)->>'id',public.get_account_deletion_request()->>'id','retry returns the same request');
select is((public.get_account_deletion_request()->>'dueAt')::timestamptz-(public.get_account_deletion_request()->>'requestedAt')::timestamptz,interval '7 days','seven day deadline');
select throws_ok('select public.platform_account_deletion_requests()','42501','forbidden','ordinary user cannot inspect platform queue');
select throws_ok('select public.platform_update_account_deletion(''e1630000-0000-4000-8000-000000000099'',false,false)','42501','forbidden','ordinary user cannot update the platform queue');
select set_config('request.jwt.claims','{"sub":"e1630000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select is(public.get_account_deletion_request(),null::jsonb,'another user cannot read request');
reset role;
select is((select count(*) from private.account_deletion_requests where user_id='e1630000-0000-4000-8000-000000000001'),1::bigint,'idempotence stores one request');
insert into public.platform_administrators(user_id,granted_by_user_id) values ('e1630000-0000-4000-8000-000000000002','e1630000-0000-4000-8000-000000000002');
set local role authenticated;
select throws_ok(format('select public.platform_update_account_deletion(%L,true,true)',(select r->>'id' from jsonb_array_elements(public.platform_account_deletion_requests()) r where r->>'contact_email'='deletion-163@example.invalid')),'22023','verify_account_removal_and_completion_notice_first','cannot mark an existing account as deleted');
reset role;
delete from auth.users where id='e1630000-0000-4000-8000-000000000001';
set local role authenticated;
select lives_ok(format('select public.platform_update_account_deletion(%L,true,true)',(select r->>'id' from jsonb_array_elements(public.platform_account_deletion_requests()) r where r->>'contact_email'='deletion-163@example.invalid')),'platform can record verified completion after auth removal');
reset role;
select is((select count(*) from private.account_deletion_requests where status='completed' and contact_email is null and organization_snapshot='[]'::jsonb),1::bigint,'completion clears request contact and organization snapshot');
select * from finish();
rollback;
