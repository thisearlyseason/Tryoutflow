begin;
select plan(21);

select has_table('public','subscription_checkout_intents','durable checkout intents exist');
select has_function('public','reserve_subscription_checkout_intent',array['uuid','uuid','text'],'owner reservation RPC exists');
select has_function('public','complete_subscription_checkout_intent',array['uuid','uuid','text','text'],'service completion RPC exists');
select has_function('public','fail_subscription_checkout_intent',array['uuid','uuid'],'service permanent-failure RPC exists');
select ok(has_function_privilege('authenticated','public.reserve_subscription_checkout_intent(uuid,uuid,text)','execute'),'authenticated owners can reserve');
select ok(not has_function_privilege('authenticated','public.complete_subscription_checkout_intent(uuid,uuid,text,text)','execute'),'browser callers cannot forge results');

insert into auth.users(id,email) values
 ('55000000-0000-4000-8000-000000000001','task25-owner@example.com'),
 ('55000000-0000-4000-8000-000000000002','task25-other@example.com');
insert into public.organizations(id,name,slug) values
 ('55000000-0000-4000-8000-000000000010','Task25 A','task25-a'),
 ('55000000-0000-4000-8000-000000000020','Task25 B','task25-b');
insert into public.organization_members(organization_id,user_id,role,status) values
 ('55000000-0000-4000-8000-000000000010','55000000-0000-4000-8000-000000000001','owner','active'),
 ('55000000-0000-4000-8000-000000000010','55000000-0000-4000-8000-000000000002','owner','active'),
 ('55000000-0000-4000-8000-000000000020','55000000-0000-4000-8000-000000000002','owner','active');

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','55000000-0000-4000-8000-000000000001',true);
select is((select outcome from public.reserve_subscription_checkout_intent('55000000-0000-4000-8000-000000000010','55000000-0000-4000-8000-000000000101','team')),'reserved','owner reserves before provider delivery');
select set_config('request.jwt.claim.sub','55000000-0000-4000-8000-000000000002',true);
select is((select outcome from public.reserve_subscription_checkout_intent('55000000-0000-4000-8000-000000000010','55000000-0000-4000-8000-000000000101','team')),'pending','a second active owner and request context reuses the durable attempt');
select set_config('request.jwt.claim.sub','55000000-0000-4000-8000-000000000001',true);
select is((select outcome from public.reserve_subscription_checkout_intent('55000000-0000-4000-8000-000000000010','55000000-0000-4000-8000-000000000101','team')),'pending','exact retry reuses pending attempt');
select is((select count(distinct idempotency_key) from public.reserve_subscription_checkout_intent('55000000-0000-4000-8000-000000000010','55000000-0000-4000-8000-000000000101','team')),1::bigint,'exact retry has one stable provider key');
select is((select outcome from public.reserve_subscription_checkout_intent('55000000-0000-4000-8000-000000000010','55000000-0000-4000-8000-000000000102','club')),'in_progress','different plan cannot pass an active attempt');
select is((select outcome from public.reserve_subscription_checkout_intent('55000000-0000-4000-8000-000000000020','55000000-0000-4000-8000-000000000103','team')),'forbidden','cross-organization reservation is denied');
reset role;

select is(public.complete_subscription_checkout_intent('55000000-0000-4000-8000-000000000010','55000000-0000-4000-8000-000000000101','cs_test_Task25Result01','https://checkout.stripe.com/c/pay/task25'),'completed','trusted completion stores exact result');
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','55000000-0000-4000-8000-000000000001',true);
select is((select outcome from public.reserve_subscription_checkout_intent('55000000-0000-4000-8000-000000000010','55000000-0000-4000-8000-000000000101','team')),'completed','same attempt replays completed result across requests');
select is((select result_url from public.reserve_subscription_checkout_intent('55000000-0000-4000-8000-000000000010','55000000-0000-4000-8000-000000000101','team')),'https://checkout.stripe.com/c/pay/task25','completed replay returns the provider URL');
select is((select outcome from public.reserve_subscription_checkout_intent('55000000-0000-4000-8000-000000000010','55000000-0000-4000-8000-000000000104','club')),'reserved','a deliberate new attempt gets a new checkout after completion');
reset role;

update public.subscription_checkout_intents set created_at=clock_timestamp()-interval '20 minutes',
  expires_at=clock_timestamp()-interval '1 second'
where client_attempt_id='55000000-0000-4000-8000-000000000104';
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','55000000-0000-4000-8000-000000000001',true);
select is((select outcome from public.reserve_subscription_checkout_intent('55000000-0000-4000-8000-000000000010','55000000-0000-4000-8000-000000000105','association')),'reserved','stale pending intent expires and releases the organization');
reset role;
select is(public.fail_subscription_checkout_intent('55000000-0000-4000-8000-000000000010','55000000-0000-4000-8000-000000000105'),'failed','permanent provider rejection releases the attempt');

update public.subscription_accounts set provider_customer_id='cus_Task25Verified1',provider_subscription_id='sub_Task25Verified1',plan_key='team',state='active',entitlement_source='stripe' where organization_id='55000000-0000-4000-8000-000000000010';
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','55000000-0000-4000-8000-000000000001',true);
select is((select outcome from public.reserve_subscription_checkout_intent('55000000-0000-4000-8000-000000000010','55000000-0000-4000-8000-000000000106','team')),'subscription_exists','verified account state prevents provider checkout');
select throws_ok($$select * from public.reserve_subscription_checkout_intent('55000000-0000-4000-8000-000000000010','00000000-0000-0000-0000-000000000000','team')$$,'22023',null,'nil attempt UUID is rejected');
reset role;

select is((select count(*) from public.subscription_checkout_intents where organization_id='55000000-0000-4000-8000-000000000010' and state='pending'),0::bigint,'no active intent remains after verified state');
select * from finish();
rollback;
