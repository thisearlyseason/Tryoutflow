begin;
select plan(29);

select has_table('public','subscription_accounts','subscription accounts exist');
select has_table('public','subscription_events','subscription event evidence exists');
select col_is_unique('public','subscription_accounts','organization_id','organization account is unique');
select col_is_unique('public','subscription_accounts','provider_customer_id','provider customer is unique');
select col_is_unique('public','subscription_accounts','provider_subscription_id','provider subscription is unique');
select ok(has_function_privilege('service_role','public.apply_stripe_subscription_event(text,text,timestamptz,text,text,text,uuid,text,text,timestamptz,timestamptz,boolean,timestamptz,timestamptz,timestamptz,jsonb,text)','execute'),'service role can invoke the narrow verified event RPC');
select ok(not has_function_privilege('authenticated','public.apply_stripe_subscription_event(text,text,timestamptz,text,text,text,uuid,text,text,timestamptz,timestamptz,boolean,timestamptz,timestamptz,timestamptz,jsonb,text)','execute'),'authenticated callers cannot forge verified events');

insert into auth.users(id,email) values
 ('51000000-0000-4000-8000-000000000001','task24-owner@example.com'),
 ('51000000-0000-4000-8000-000000000002','task24-other@example.com');
insert into public.organizations(id,name,slug) values
 ('51000000-0000-4000-8000-000000000010','Task24 A','task24-a'),
 ('51000000-0000-4000-8000-000000000020','Task24 B','task24-b');
insert into public.organization_members(organization_id,user_id,role,status) values
 ('51000000-0000-4000-8000-000000000010','51000000-0000-4000-8000-000000000001','owner','active'),
 ('51000000-0000-4000-8000-000000000020','51000000-0000-4000-8000-000000000002','owner','active');

select is((select count(*) from public.subscription_accounts where organization_id in('51000000-0000-4000-8000-000000000010','51000000-0000-4000-8000-000000000020')),2::bigint,'one system trial account is created per organization');
select throws_ok($$insert into public.subscription_accounts(organization_id,plan_key,state,entitlement_source,verified_at) values('51000000-0000-4000-8000-000000000010','trial','trialing','system_trial',now())$$,'23505',null,'a second organization account is rejected');

set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','51000000-0000-4000-8000-000000000001',true);
select is((select count(*) from public.subscription_accounts),1::bigint,'RLS exposes only the caller organization account');
select is((select count(*) from public.get_owned_subscription_account('51000000-0000-4000-8000-000000000010')),1::bigint,'owner can load own billing mapping');
select is((select count(*) from public.get_owned_subscription_account('51000000-0000-4000-8000-000000000020')),0::bigint,'owner cannot load another organization billing mapping');
select throws_ok($$update public.subscription_accounts set state='active' where organization_id='51000000-0000-4000-8000-000000000010'$$,'42501',null,'authenticated direct account update is denied');
select throws_ok($$insert into public.subscription_events(provider_event_id,event_type,provider_created_at,event_precedence,payload,payload_digest,outcome) values('evt_Direct0001','customer.subscription.updated',now(),200,'{}',repeat('a',64),'applied')$$,'42501',null,'authenticated direct evidence insert is denied');
reset role;

select is(public.apply_stripe_subscription_event('evt_Task24One01','customer.subscription.updated','2026-08-30T12:00:00Z','cus_task24aa','sub_task24aa','price_Task24Team1','51000000-0000-4000-8000-000000000010','team','active','2026-08-01','2026-09-01',false,null,null,null,'{"verified":true}',repeat('a',64)),'applied','a service-role-shaped verified event applies');
select is(public.apply_stripe_subscription_event('evt_Task24One01','customer.subscription.updated','2026-08-30T12:00:00Z','cus_task24aa','sub_task24aa','price_Task24Team1','51000000-0000-4000-8000-000000000010','team','active','2026-08-01','2026-09-01',false,null,null,null,'{"verified":true}',repeat('a',64)),'replayed','an exact provider event replays');
select is(public.apply_stripe_subscription_event('evt_Task24One01','customer.subscription.updated','2026-08-30T12:00:00Z','cus_task24aa','sub_task24aa','price_Task24Club1','51000000-0000-4000-8000-000000000010','club','active','2026-08-01','2026-09-01',false,null,null,null,'{"verified":false}',repeat('b',64)),'event_conflict','an event ID cannot be rebound to another body');
select is(public.apply_stripe_subscription_event('evt_Task24Old01','customer.subscription.deleted','2026-08-30T11:59:59Z','cus_task24aa','sub_task24aa','price_Task24Team1','51000000-0000-4000-8000-000000000010','team','canceled','2026-08-01','2026-09-01',false,null,null,null,'{"old":true}',repeat('c',64)),'ignored_out_of_order','older events never regress state');
select is((select plan_key||'|'||state from public.subscription_accounts where organization_id='51000000-0000-4000-8000-000000000010'),'team|active','the latest verified state remains authoritative');
select is(public.apply_stripe_subscription_event('evt_Task24Conflict01','customer.subscription.updated','2026-08-30T12:01:00Z','cus_task24aa','sub_task24bb','price_Task24Team1','51000000-0000-4000-8000-000000000020','team','active','2026-08-01','2026-09-01',false,null,null,null,'{"conflict":true}',repeat('d',64)),'customer_conflict','one provider customer cannot cross organizations');
select is((select entitlement_source from public.subscription_accounts where organization_id='51000000-0000-4000-8000-000000000020'),'system_trial','customer conflict grants no entitlement');

select throws_ok($$update public.subscription_events set outcome='applied' where provider_event_id='evt_Task24Old01'$$,'55000',null,'event evidence is append-only on update');
select throws_ok($$delete from public.subscription_events where provider_event_id='evt_Task24Old01'$$,'55000',null,'event evidence is append-only on delete');
select throws_ok($$truncate public.subscription_events$$,'55000',null,'event evidence cannot be truncated');
select throws_ok($$delete from public.organizations where id='51000000-0000-4000-8000-000000000010'$$,'55000',null,'parent deletion cannot erase event evidence');

select is((select public.organization_subscription_can_publish('51000000-0000-4000-8000-000000000010')),true,'active verified subscriptions can publish');
update public.subscription_accounts set state='past_due' where organization_id='51000000-0000-4000-8000-000000000010';
select is((select public.organization_subscription_can_publish('51000000-0000-4000-8000-000000000010')),false,'past-due stored state fails the publish gate');
insert into public.tryouts(
  id,organization_id,name,slug,sport,timezone
) values(
  '51000000-0000-4000-8000-000000000030','51000000-0000-4000-8000-000000000010',
  'Subscription-gated tryout','task24-gated-tryout','Hockey','America/Edmonton'
);
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','51000000-0000-4000-8000-000000000001',true);
select is((select outcome from public.publish_tryout(
  '51000000-0000-4000-8000-000000000010','51000000-0000-4000-8000-000000000030',0
)),'subscription_required','the real publication command denies non-entitled stored state');
reset role;
update public.subscription_accounts set state='active'
where organization_id='51000000-0000-4000-8000-000000000010';
set local role authenticated;
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claim.sub','51000000-0000-4000-8000-000000000001',true);
select is((select outcome from public.publish_tryout(
  '51000000-0000-4000-8000-000000000010','51000000-0000-4000-8000-000000000030',0
)),'division_missing','verified active state reaches ordinary publication validation');
reset role;

select * from finish();
rollback;
