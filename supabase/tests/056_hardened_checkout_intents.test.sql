begin;
select plan(33);

select has_column('public','subscription_checkout_intents','initiating_owner_user_id','intent binds initiating owner');
select has_function('public','reserve_subscription_checkout_intent',array['uuid','uuid','text','uuid'],'owner-bound reservation RPC exists');
select has_function('public','purge_expired_subscription_checkout_intents',array['integer'],'bounded purge RPC exists');
select ok(not has_function_privilege('authenticated','public.purge_expired_subscription_checkout_intents(integer)','execute'),'browser cannot purge checkout evidence');

insert into auth.users(id,email) values
 ('56000000-0000-4000-8000-000000000001','task25-fix-owner@example.com'),
 ('56000000-0000-4000-8000-000000000002','task25-fix-coowner@example.com');
insert into public.organizations(id,name,slug) values
 ('56000000-0000-4000-8000-000000000010','Task25 Fix','task25-fix');
insert into public.organization_members(organization_id,user_id,role,status) values
 ('56000000-0000-4000-8000-000000000010','56000000-0000-4000-8000-000000000001','owner','active'),
 ('56000000-0000-4000-8000-000000000010','56000000-0000-4000-8000-000000000002','owner','active');

select lives_ok($$insert into public.subscription_checkout_intents(
  organization_id,client_attempt_id,plan_key,idempotency_key,state
) values(
  '56000000-0000-4000-8000-000000000010','56000000-0000-4000-8000-000000000199',
  'team','tryoutflow:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','failed'
)$$,'legacy failed tombstone remains valid without fabricated owner');
delete from public.subscription_checkout_intents
where client_attempt_id='56000000-0000-4000-8000-000000000199';

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','56000000-0000-4000-8000-000000000001',true);
select is((select outcome from public.reserve_subscription_checkout_intent('56000000-0000-4000-8000-000000000010','56000000-0000-4000-8000-000000000101','team','56000000-0000-4000-8000-000000000001')),'reserved','initiator reserves checkout');
select set_config('request.jwt.claim.sub','56000000-0000-4000-8000-000000000002',true);
select is((select outcome from public.reserve_subscription_checkout_intent('56000000-0000-4000-8000-000000000010','56000000-0000-4000-8000-000000000101','team','56000000-0000-4000-8000-000000000002')),'forbidden','co-owner cannot replay exact attempt');
select is((select outcome from public.reserve_subscription_checkout_intent('56000000-0000-4000-8000-000000000010','56000000-0000-4000-8000-000000000102','club','56000000-0000-4000-8000-000000000002')),'in_progress','co-owner receives non-oracular active fence');
reset role;

select throws_ok(
  $$select public.complete_subscription_checkout_intent(
    '56000000-0000-4000-8000-000000000010',
    '56000000-0000-4000-8000-000000000101',
    'cs_test_'||repeat('A',201),
    'https://checkout.stripe.com/c/pay/cs_test_'||repeat('A',201)
  )$$,
  '22023',null,'durable completion rejects checkout object ID suffix over cap'
);
select is(public.complete_subscription_checkout_intent('56000000-0000-4000-8000-000000000010','56000000-0000-4000-8000-000000000101','cs_test_Task25FixResult01','https://checkout.stripe.com/c/pay/cs_test_Task25FixResult01#fidkdWxOYHwnPyd1blpx'),'completed','exact checkout URL completes');
select ok(private.is_valid_billing_session_url('cs_test_Task25LongFragment','https://checkout.stripe.com/c/pay/cs_test_Task25LongFragment#'||repeat('A',300),'checkout'),'bounded real Stripe opaque fragments are accepted');
select ok(not private.is_valid_billing_session_url('cs_test_Task25Newline','https://checkout.stripe.com/c/pay/cs_test_Task25Newline'||chr(10),'checkout'),'terminal newline is rejected');
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','56000000-0000-4000-8000-000000000001',true);
select is((select outcome from public.reserve_subscription_checkout_intent('56000000-0000-4000-8000-000000000010','56000000-0000-4000-8000-000000000101','team','56000000-0000-4000-8000-000000000001')),'completed','initiator replays completed checkout');
select is((select outcome from public.reserve_subscription_checkout_intent('56000000-0000-4000-8000-000000000010','56000000-0000-4000-8000-000000000103','association','56000000-0000-4000-8000-000000000001')),'in_progress','completed checkout remains organization fence');
reset role;

select throws_ok($$select public.complete_subscription_checkout_intent('56000000-0000-4000-8000-000000000010','56000000-0000-4000-8000-000000000101','cs_test_Task25FixResult01','https://checkout.stripe.com/c/pay/other')$$,'22023',null,'URL ID mismatch rejected');
select throws_ok($$select public.complete_subscription_checkout_intent('56000000-0000-4000-8000-000000000010','56000000-0000-4000-8000-000000000101','cs_test_Task25FixResult01','https://checkout.stripe.com/c/pay/cs_test_Task25FixResult01?x=1')$$,'22023',null,'checkout query rejected');
select ok(private.is_valid_billing_session_url('cs_test_Task25FixResult01','https://checkout.stripe.com/c/pay/cs_test_Task25FixResult01#bad%20fragment','checkout'),'well-formed encoded checkout fragment accepted');
select throws_ok($$select public.complete_subscription_checkout_intent('56000000-0000-4000-8000-000000000010','56000000-0000-4000-8000-000000000101',null,'https://checkout.stripe.com/c/pay/cs_test_Task25FixResult01')$$,'22023',null,'null checkout session ID rejected');
select throws_ok($$select public.complete_subscription_checkout_intent('56000000-0000-4000-8000-000000000010','56000000-0000-4000-8000-000000000101','cs_test_Task25FixResult01',null)$$,'22023',null,'null checkout URL rejected');

update public.subscription_checkout_intents set created_at=clock_timestamp()-interval '20 minutes',
  expires_at=clock_timestamp()-interval '1 second'
where organization_id='56000000-0000-4000-8000-000000000010';
select is(public.purge_expired_subscription_checkout_intents(1),1,'processor purge expires one checkout intent');
select is((select state from public.subscription_checkout_intents where organization_id='56000000-0000-4000-8000-000000000010'),'expired','purge leaves tombstone');
select is((select result_url from public.subscription_checkout_intents where organization_id='56000000-0000-4000-8000-000000000010'),null,'purge redacts URL');
select is((select provider_session_id from public.subscription_checkout_intents where organization_id='56000000-0000-4000-8000-000000000010'),null,'purge redacts provider session ID');

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','56000000-0000-4000-8000-000000000001',true);
select is((select outcome from public.reserve_subscription_checkout_intent('56000000-0000-4000-8000-000000000010','56000000-0000-4000-8000-000000000104','club','56000000-0000-4000-8000-000000000001')),'reserved','new checkout allowed after purge expiry');
reset role;

delete from public.organization_members where organization_id='56000000-0000-4000-8000-000000000010' and user_id='56000000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','56000000-0000-4000-8000-000000000001',true);
select is((select outcome from public.reserve_subscription_checkout_intent('56000000-0000-4000-8000-000000000010','56000000-0000-4000-8000-000000000104','club','56000000-0000-4000-8000-000000000001')),'forbidden','offboarded initiator cannot replay');
reset role;

select is((select state from public.subscription_checkout_intents where organization_id='56000000-0000-4000-8000-000000000010' and client_attempt_id='56000000-0000-4000-8000-000000000104'),'expired','offboarding immediately expires the initiator checkout');
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','56000000-0000-4000-8000-000000000002',true);
select is((select outcome from public.reserve_subscription_checkout_intent('56000000-0000-4000-8000-000000000010','56000000-0000-4000-8000-000000000105','association','56000000-0000-4000-8000-000000000002')),'reserved','remaining owner can start after initiator offboarding cleanup');
reset role;

update public.subscription_accounts set provider_customer_id='cus_Task25FixCustomer',provider_subscription_id='sub_Task25FixSubscribe',plan_key='club',state='active',entitlement_source='stripe'
where organization_id='56000000-0000-4000-8000-000000000010';
select is((select state from public.subscription_checkout_intents where organization_id='56000000-0000-4000-8000-000000000010' and client_attempt_id='56000000-0000-4000-8000-000000000105'),'expired','verified account activation atomically expires checkout intent');
select is((select result_url from public.subscription_checkout_intents where organization_id='56000000-0000-4000-8000-000000000010' and client_attempt_id='56000000-0000-4000-8000-000000000105'),null,'activation keeps checkout URL redacted');

select throws_ok($$select public.purge_expired_subscription_checkout_intents(0)$$,'22023',null,'purge rejects zero batch');
select throws_ok($$select public.purge_expired_subscription_checkout_intents(501)$$,'22023',null,'purge rejects oversized batch');
select hasnt_function('public','reserve_subscription_checkout_intent',array['uuid','uuid','text'],'legacy owner-unbound reservation is unavailable');
select is((select initiating_owner_user_id from public.subscription_checkout_intents where organization_id='56000000-0000-4000-8000-000000000010' order by created_at limit 1),'56000000-0000-4000-8000-000000000001'::uuid,'tombstone retains exact initiating owner');

select * from finish();
rollback;
