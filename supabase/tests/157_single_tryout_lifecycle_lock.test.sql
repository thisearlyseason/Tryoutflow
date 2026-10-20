begin;
select no_plan();
update private.billing_configuration set enabled=true,access_enabled=true;
insert into auth.users(id,email) values ('e1570000-0000-4000-8000-000000000001','single-owner@example.test'),('e1570000-0000-4000-8000-000000000002','single-outsider@example.test');
insert into public.organizations(id,name,slug) values ('e1570000-0000-4000-8000-000000000010','Single lock test','single-lock-test');
insert into public.organization_members(organization_id,user_id,role,status) values ('e1570000-0000-4000-8000-000000000010','e1570000-0000-4000-8000-000000000001','owner','active');
insert into public.tryouts(id,organization_id,name,slug,sport,timezone,registration_starts_at,registration_ends_at)
select ('e1570000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'e1570000-0000-4000-8000-000000000010','Event '||n,'single-lock-'||n,'Hockey','UTC',now()-interval '1 day',now()+interval '1 day' from generate_series(20,24) n;
insert into public.tryout_divisions(id,organization_id,tryout_id,name,sort_order)
select ('e1570000-0000-4000-8000-'||lpad((n+10)::text,12,'0'))::uuid,'e1570000-0000-4000-8000-000000000010',('e1570000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'U15',0 from generate_series(20,24) n;
insert into public.tryout_sessions(id,organization_id,tryout_id,division_id,name,starts_at,ends_at,sort_order)
select ('e1570000-0000-4000-8000-'||lpad((n+20)::text,12,'0'))::uuid,'e1570000-0000-4000-8000-000000000010',('e1570000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,('e1570000-0000-4000-8000-'||lpad((n+10)::text,12,'0'))::uuid,'Skills',now()+interval '2 days',now()+interval '3 days',0 from generate_series(20,24) n;
insert into public.billing_contracts(organization_id,tryout_id,purchaser_id,provider,environment,provider_contract_id,provider_customer_id,product_key,status,current_period_start,observed_at)
values('e1570000-0000-4000-8000-000000000010','e1570000-0000-4000-8000-000000000020','e1570000-0000-4000-8000-000000000001','stripe',(select environment from private.billing_configuration),'single-lock-payment','single-lock-customer','single_tryout_pro','active',now()-interval '1 day',now());
select is((select count(*) from private.single_tryout_events where organization_id='e1570000-0000-4000-8000-000000000010'),0::bigint,'purchase leaves draft editable');
select lives_ok($$update public.tryouts set name='Final event name' where id='e1570000-0000-4000-8000-000000000020'$$,'draft details can be corrected before publishing');
update public.tryouts set status='published',published_at=now() where id='e1570000-0000-4000-8000-000000000020';
select is((select count(*) from private.single_tryout_events where tryout_id='e1570000-0000-4000-8000-000000000020'),1::bigint,'publishing consumes license exactly once');
select is((select locks_at-last_session_at from private.single_tryout_events where tryout_id='e1570000-0000-4000-8000-000000000020'),interval '7 days','fixed wrap-up deadline');
select throws_ok($$update public.tryouts set name='Next season' where id='e1570000-0000-4000-8000-000000000020'$$,'42501','single_tryout_identity_locked','direct event rename blocked');
select throws_ok($$update public.tryouts set registration_ends_at=now()+interval '1 year' where id='e1570000-0000-4000-8000-000000000020'$$,'42501','single_tryout_identity_locked','registration extension blocked');
select throws_ok($$update public.tryout_sessions set ends_at=ends_at+interval '1 year' where id='e1570000-0000-4000-8000-000000000040'$$,'42501','single_tryout_identity_locked','session date extension blocked');
select throws_ok($$delete from public.tryout_sessions where id='e1570000-0000-4000-8000-000000000040'$$,'42501','single_tryout_identity_locked','delete and recreate session blocked');
select throws_ok($$insert into public.tryout_sessions(organization_id,tryout_id,division_id,name,starts_at,ends_at,sort_order) values('e1570000-0000-4000-8000-000000000010','e1570000-0000-4000-8000-000000000020','e1570000-0000-4000-8000-000000000030','Next event',now()+interval '5 days',now()+interval '6 days',1)$$,'42501','single_tryout_identity_locked','extra session blocked');
select throws_ok($$update public.tryout_divisions set name='Different age group' where id='e1570000-0000-4000-8000-000000000030'$$,'42501','single_tryout_identity_locked','division repurposing blocked');
select throws_ok($$delete from private.single_tryout_events where tryout_id='e1570000-0000-4000-8000-000000000020'$$,'42501','billing_history_immutable','consumption cannot be erased');
select ok(not has_function_privilege('authenticated','private.seal_single_tryout(uuid,uuid)','EXECUTE'),'cannot invoke sealing helper');
select ok(not has_table_privilege('service_role','private.single_tryout_events','UPDATE'),'service role cannot reset ledger');
select ok(not has_function_privilege('anon','public.complete_single_tryout(uuid,uuid,integer)','EXECUTE'),'anonymous completion denied');
set local role authenticated;
select set_config('request.jwt.claim.sub','e1570000-0000-4000-8000-000000000001',true);
select is(public.get_single_tryout_lifecycle('e1570000-0000-4000-8000-000000000010','e1570000-0000-4000-8000-000000000020')->>'locked','false','published single is operational');
select throws_ok($$select public.save_tryout_wizard_configuration('e1570000-0000-4000-8000-000000000010','e1570000-0000-4000-8000-000000000020','basics','{"name":"Reused event","sport":"Soccer","timezone":"UTC","registrationStartsAt":"2026-09-17T00:00:00Z","registrationEndsAt":"2026-09-18T00:00:00Z"}')$$,'42501','single_tryout_identity_locked','authorized setup RPC cannot bypass identity lock');
select is(public.complete_single_tryout('e1570000-0000-4000-8000-000000000010','e1570000-0000-4000-8000-000000000020',-1),'conflict','stale completion does not lock event');
select set_config('request.jwt.claim.sub','e1570000-0000-4000-8000-000000000002',true);
select throws_ok($$select public.complete_single_tryout('e1570000-0000-4000-8000-000000000010','e1570000-0000-4000-8000-000000000020',0)$$,'42501','forbidden','other tenant cannot complete');
select throws_ok($$select public.get_single_tryout_lifecycle('e1570000-0000-4000-8000-000000000010','e1570000-0000-4000-8000-000000000020')$$,'42501','forbidden','other tenant cannot inspect license');
select set_config('request.jwt.claim.sub','e1570000-0000-4000-8000-000000000001',true);
select is(public.complete_single_tryout('e1570000-0000-4000-8000-000000000010','e1570000-0000-4000-8000-000000000020',(select version from public.tryouts where id='e1570000-0000-4000-8000-000000000020')),'completed','owner can complete event');
select is(public.complete_single_tryout('e1570000-0000-4000-8000-000000000010','e1570000-0000-4000-8000-000000000020',0),'completed','completion retry is idempotent');
select is(public.get_single_tryout_lifecycle('e1570000-0000-4000-8000-000000000010','e1570000-0000-4000-8000-000000000020')->>'locked','true','completed event is read-only');
select lives_ok($$select public.load_report_summary('e1570000-0000-4000-8000-000000000010','e1570000-0000-4000-8000-000000000020')$$,'completed results remain readable');
select lives_ok($$select public.load_report_export('e1570000-0000-4000-8000-000000000010','athletes','e1570000-0000-4000-8000-000000000020')$$,'completed exports remain available');
select is(public.get_effective_entitlements('e1570000-0000-4000-8000-000000000010','e1570000-0000-4000-8000-000000000021')->'features'->>'publish_tryout',null::text,'license does not cover a second event');
reset role;
select throws_ok($$update public.tryouts set status='draft',finalized_at=null where id='e1570000-0000-4000-8000-000000000020'$$,'42501','single_tryout_locked','completion cannot be reset');
select throws_ok($$insert into public.event_notices(organization_id,tryout_id,title,body,category,status) values('e1570000-0000-4000-8000-000000000010','e1570000-0000-4000-8000-000000000020','Reuse notice','New tryout','general','draft')$$,'42501','single_tryout_locked','operational writes denied at database boundary');
select throws_ok($$delete from public.tryouts where id='e1570000-0000-4000-8000-000000000020'$$,'42501','single_tryout_locked','cannot delete licensed event to recycle purchase');
select throws_ok($$insert into private.billing_purchase_intents(id,organization_id,tryout_id,purchaser_id,product_key,provider,environment) values(gen_random_uuid(),'e1570000-0000-4000-8000-000000000010','e1570000-0000-4000-8000-000000000020','e1570000-0000-4000-8000-000000000001','single_tryout_pro','stripe',(select environment from private.billing_configuration))$$,'42501','single_tryout_locked','checkout cannot sell reopening of completed event');
update public.billing_contracts set observed_at=now()+interval '1 minute' where provider_contract_id='single-lock-payment';
select throws_ok($$update public.tryouts set name='Receipt replay reuse' where id='e1570000-0000-4000-8000-000000000020'$$,'42501','single_tryout_locked','receipt replay cannot reopen');
update public.billing_contracts set status='refunded' where provider_contract_id='single-lock-payment';
select throws_ok($$delete from public.tryouts where id='e1570000-0000-4000-8000-000000000020'$$,'42501','single_tryout_locked','refund retains permanent consumed event');
-- An event left published still expires without a cron job or owner action.
update public.tryouts set registration_starts_at=now()-interval '13 days',registration_ends_at=now()-interval '12 days' where id='e1570000-0000-4000-8000-000000000021';
update public.tryout_sessions set starts_at=now()-interval '11 days',ends_at=now()-interval '10 days' where id='e1570000-0000-4000-8000-000000000041';
insert into public.billing_overrides(organization_id,tryout_id,product_key,reason,starts_at,expires_at) values('e1570000-0000-4000-8000-000000000010','e1570000-0000-4000-8000-000000000021','single_tryout_pro','Single policy test',now()-interval '1 day',now()+interval '1 day');
update public.tryouts set status='published',published_at=now() where id='e1570000-0000-4000-8000-000000000021';
select throws_ok($$insert into public.event_notices(organization_id,tryout_id,title,body,category,status) values('e1570000-0000-4000-8000-000000000010','e1570000-0000-4000-8000-000000000021','Never completed','Still running','general','draft')$$,'42501','single_tryout_locked','deadline locks even without completion');
-- Do not allow a year of sessions to be hidden inside one tryout.
update public.tryout_sessions set ends_at=starts_at+interval '15 days' where id='e1570000-0000-4000-8000-000000000042';
insert into public.billing_overrides(organization_id,tryout_id,product_key,reason,starts_at,expires_at) values('e1570000-0000-4000-8000-000000000010','e1570000-0000-4000-8000-000000000022','single_tryout_pro','Single policy test',now()-interval '1 day',now()+interval '1 day');
select throws_ok($$update public.tryouts set status='published',published_at=now() where id='e1570000-0000-4000-8000-000000000022'$$,'42501','single_tryout_schedule_invalid','oversized session window cannot publish');
-- Subscriptions do not inherit single-event restrictions.
insert into public.billing_overrides(organization_id,product_key,reason,starts_at,expires_at) values('e1570000-0000-4000-8000-000000000010','pro_monthly','Subscription control',now()-interval '1 day',now()+interval '1 day');
update public.tryouts set status='published',published_at=now() where id='e1570000-0000-4000-8000-000000000023';
select is((select count(*) from private.single_tryout_events where tryout_id='e1570000-0000-4000-8000-000000000023'),0::bigint,'ordinary Pro event has no single-use restriction');
set local role authenticated;
select is((select outcome from public.save_tryout_wizard_configuration('e1570000-0000-4000-8000-000000000010','e1570000-0000-4000-8000-000000000023','basics','{"name":"Updated subscription event","sport":"Hockey","timezone":"UTC","registrationStartsAt":"2026-09-17T00:00:00Z","registrationEndsAt":"2026-09-18T00:00:00Z"}')),'saved','Pro retains setup editing');
reset role;
select throws_ok($$update public.tryouts set name='Upgrade escape' where id='e1570000-0000-4000-8000-000000000020'$$,'42501','single_tryout_locked','subscription upgrade cannot reset consumed event');
select is((select count(*) from public.tryouts where id='e1570000-0000-4000-8000-000000000020'),1::bigint,'original event preserved');
select * from finish();
rollback;
