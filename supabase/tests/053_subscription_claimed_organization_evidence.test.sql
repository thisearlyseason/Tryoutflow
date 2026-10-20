begin;
select plan(24);

select has_column('public','subscription_events','claimed_organization_id',
  'event evidence preserves the provider-claimed organization separately');
select col_is_null('public','subscription_events','organization_id',
  'the actual bound organization remains nullable');
select col_is_null('public','subscription_events','claimed_organization_id',
  'missing or invalid provider metadata remains representable');

insert into public.organizations(id,name,slug) values
 ('53000000-0000-4000-8000-000000000010','Task24 claim A','task24-claim-a'),
 ('53000000-0000-4000-8000-000000000020','Task24 claim B','task24-claim-b'),
 ('53000000-0000-4000-8000-000000000030','Task24 deleted claim','task24-deleted-claim');

delete from public.organizations where id='53000000-0000-4000-8000-000000000030';

select is(public.apply_stripe_subscription_event(
  'evt_DeletedClaim01','customer.subscription.updated','2026-08-30T14:00:00Z',
  'cus_DeletedClaim01','sub_DeletedClaim01','price_Task24Team1',
  '53000000-0000-4000-8000-000000000030','team','active',
  '2026-08-01','2026-09-01',false,null,null,null,
  '{"claim":"deleted"}',repeat('1',64)),
  'unbound','the first webhook after organization deletion is retained without mutation');
select results_eq($$select organization_id,claimed_organization_id,outcome
  from public.subscription_events where provider_event_id='evt_DeletedClaim01'$$,
  $$select * from (values(null::uuid,'53000000-0000-4000-8000-000000000030'::uuid,
    'unbound'::text)) expected(organization_id,claimed_organization_id,outcome)$$,
  'deleted claim evidence keeps the exact claim and no bound FK');
select is((select count(*) from public.subscription_accounts
  where organization_id='53000000-0000-4000-8000-000000000030'),0::bigint,
  'a stale claim cannot recreate or mutate an account');
select is(public.apply_stripe_subscription_event(
  'evt_DeletedClaim01','customer.subscription.updated','2026-08-30T14:00:00Z',
  'cus_DeletedClaim01','sub_DeletedClaim01','price_Task24Team1',
  '53000000-0000-4000-8000-000000000030','team','active',
  '2026-08-01','2026-09-01',false,null,null,null,
  '{"claim":"deleted"}',repeat('1',64)),
  'replayed','exact stale-claim delivery replays without another mutation');
select is(public.apply_stripe_subscription_event(
  'evt_DeletedClaim01','customer.subscription.updated','2026-08-30T14:00:00Z',
  'cus_DeletedClaim01','sub_DeletedClaim01','price_Task24Team1',
  '53000000-0000-4000-8000-000000000030','team','active',
  '2026-08-01','2026-09-01',false,null,null,null,
  '{"claim":"changed"}',repeat('2',64)),
  'event_conflict','stale claim digest conflict retains exact first evidence');
select is(public.apply_stripe_subscription_event(
  'evt_DeletedOlder01','customer.subscription.updated','2026-08-30T13:00:00Z',
  'cus_DeletedClaim01','sub_DeletedClaim01','price_Task24Team1',
  '53000000-0000-4000-8000-000000000030','team','canceled',
  '2026-08-01','2026-09-01',false,null,null,null,
  '{"claim":"older"}',repeat('3',64)),
  'unbound','out-of-order stale claims remain unbound rather than gaining authority');
select is((select count(*) from public.subscription_events
  where claimed_organization_id='53000000-0000-4000-8000-000000000030'),2::bigint,
  'duplicate and out-of-order stale deliveries retain one row per provider event');
select is(public.apply_stripe_subscription_event(
  'evt_NeverExisted1','customer.subscription.updated','2026-08-30T13:30:00Z',
  'cus_NeverExisted1','sub_NeverExisted1','price_Task24Team1',
  '53000000-0000-4000-8000-000000000040','team','active',
  '2026-08-01','2026-09-01',false,null,null,null,
  '{"claim":"never-existed"}',repeat('7',64)),
  'unbound','a nonexistent organization claim has the same non-oracular outcome');
select results_eq($$select organization_id,claimed_organization_id
  from public.subscription_events where provider_event_id='evt_NeverExisted1'$$,
  $$select * from (values(null::uuid,'53000000-0000-4000-8000-000000000040'::uuid))
    expected(organization_id,claimed_organization_id)$$,
  'nonexistent organization evidence preserves its claim without a false FK binding');

select is(public.apply_stripe_subscription_event(
  'evt_BoundClaim001','customer.subscription.updated','2026-08-30T14:00:00Z',
  'cus_BoundClaim001','sub_BoundClaim001','price_Task24Team1',
  '53000000-0000-4000-8000-000000000010','team','active',
  '2026-08-01','2026-09-01',false,null,null,null,
  '{"claim":"bound"}',repeat('4',64)),
  'applied','an existing claimed organization still applies normally');
select results_eq($$select organization_id,claimed_organization_id
  from public.subscription_events where provider_event_id='evt_BoundClaim001'$$,
  $$select * from (values('53000000-0000-4000-8000-000000000010'::uuid,
    '53000000-0000-4000-8000-000000000010'::uuid))
    expected(organization_id,claimed_organization_id)$$,
  'bound evidence stores both actual and claimed organization identity');
select is(public.apply_stripe_subscription_event(
  'evt_StaleMapped01','customer.subscription.updated','2026-08-30T14:05:00Z',
  'cus_BoundClaim001','sub_BoundClaim001','price_Task24Team1',
  '53000000-0000-4000-8000-000000000040','team','canceled',
  '2026-08-01','2026-09-01',false,null,null,null,
  '{"claim":"stale-mapped"}',repeat('8',64)),
  'unbound','stale metadata does not reveal or adopt an existing provider mapping');
select is((select last_provider_event_id from public.subscription_accounts
  where organization_id='53000000-0000-4000-8000-000000000010'),
  'evt_BoundClaim001','stale mapped metadata cannot mutate the actual mapped account');
select is((select organization_id from public.subscription_events
  where provider_event_id='evt_StaleMapped01'),null::uuid,
  'stale mapped evidence remains explicitly unbound');
select is(public.apply_stripe_subscription_event(
  'evt_CrossTenant01','customer.subscription.updated','2026-08-30T14:01:00Z',
  'cus_BoundClaim001','sub_CrossTenant01','price_Task24Team1',
  '53000000-0000-4000-8000-000000000020','team','active',
  '2026-08-01','2026-09-01',false,null,null,null,
  '{"claim":"cross"}',repeat('5',64)),
  'customer_conflict','existing cross-tenant customer mapping remains a distinct conflict');
select is((select entitlement_source from public.subscription_accounts
  where organization_id='53000000-0000-4000-8000-000000000020'),'system_trial',
  'cross-tenant conflict cannot mutate the claimed account');

select public.apply_stripe_subscription_event(
  'evt_BackfillClaim1','customer.subscription.updated','2026-08-30T14:02:00Z',
  'cus_BackfillClaim1','sub_BackfillClaim1','price_Task24Team1',
  '53000000-0000-4000-8000-000000000020','team','active',
  '2026-08-01','2026-09-01',false,null,null,null,
  '{"claim":"backfill"}',repeat('6',64));
select is((select claimed_organization_id from public.subscription_events
  where provider_event_id='evt_BackfillClaim1'),
  '53000000-0000-4000-8000-000000000020'::uuid,
  'new bound rows preserve claimed identity for future migration parity');

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','53000000-0000-4000-8000-000000000099',true);
select throws_ok($$select claimed_organization_id from public.subscription_events limit 1$$,
  '42501',null,'authenticated callers cannot read claimed subscription evidence');
reset role;
select ok(not has_table_privilege('service_role','public.subscription_events','select'),
  'service role cannot bypass the narrow RPC to project claimed metadata');
select ok(not has_table_privilege('authenticated','public.subscription_events','select'),
  'authenticated has no direct event projection privilege');
select is((select count(*) from public.subscription_events where claimed_organization_id is null),
  (select count(*) from public.subscription_events where organization_id is null
    and claimed_organization_id is null),
  'nullable claimed metadata never fabricates an organization identity');

select * from finish();
rollback;
