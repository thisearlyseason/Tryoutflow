begin;
select plan(4);
update private.billing_configuration set access_enabled=true,enabled=false;
insert into auth.users(id) values ('f1590000-0000-4000-8000-000000000001');
insert into public.organizations(id,name,slug) values
 ('f1590000-0000-4000-8000-000000000002','Existing trial','seven-day-compatibility');
insert into public.organization_members(organization_id,user_id,role,status) values
 ('f1590000-0000-4000-8000-000000000002','f1590000-0000-4000-8000-000000000001','owner','active');
insert into private.pro_trials values
 ('f1590000-0000-4000-8000-000000000002','f1590000-0000-4000-8000-000000000001',now()-interval '1 hour',now()+interval '71 hours');
select is(private.effective_billing_access('f1590000-0000-4000-8000-000000000002')->>'plan','pro','an existing three-day trial retains access');
set local role authenticated;
select set_config('request.jwt.claim.sub','f1590000-0000-4000-8000-000000000001',true);
select is((public.start_pro_trial('f1590000-0000-4000-8000-000000000002')->'trial'->>'expiresAt')::timestamptz,now()+interval '71 hours','retry preserves the old expiry instead of granting another seven days');
reset role;
select throws_ok($$update private.pro_trials set expires_at=starts_at+interval '8 days' where organization_id='f1590000-0000-4000-8000-000000000002'$$,'23514',null,'arbitrary trial durations remain invalid');
select ok(not has_function_privilege('anon','public.start_pro_trial(uuid)','EXECUTE'),'duration migration preserves RPC privileges');
select * from finish();
rollback;
