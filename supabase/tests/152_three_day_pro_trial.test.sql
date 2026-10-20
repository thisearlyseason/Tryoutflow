begin;
select no_plan();
update private.billing_configuration set enabled=false;
insert into auth.users(id,email) values
('c1000000-0000-4000-8000-000000000001','trial-owner@example.test'),
('c1000000-0000-4000-8000-000000000002','trial-member@example.test'),
('c1000000-0000-4000-8000-000000000003','trial-other@example.test');
insert into public.organizations(id,name,slug) values('c2000000-0000-4000-8000-000000000009','Existing','trial-existing');
select is(private.effective_billing_access('c2000000-0000-4000-8000-000000000009')->>'source','legacy','existing trials retain their access');
update private.billing_configuration set enabled=true;
insert into public.organizations(id,name,slug) values
('c2000000-0000-4000-8000-000000000001','New Trial','trial-new'),
('c2000000-0000-4000-8000-000000000002','Second Trial','trial-second'),
('c2000000-0000-4000-8000-000000000003','Other Trial','trial-other');
insert into public.organization_members(organization_id,user_id,role,status) values
('c2000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000001','owner','active'),
('c2000000-0000-4000-8000-000000000002','c1000000-0000-4000-8000-000000000001','owner','active'),
('c2000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000002','member','active'),
('c2000000-0000-4000-8000-000000000003','c1000000-0000-4000-8000-000000000003','owner','active');
insert into public.tryouts(id,organization_id,name,slug,sport,timezone) values
('c3000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000001','Retained Tryout','retained-trial','Soccer','America/Edmonton');
select is(private.effective_billing_access('c2000000-0000-4000-8000-000000000001')->>'plan','free','new organization does not start trial during setup');
select ok(not has_function_privilege('anon','public.start_pro_trial(uuid)','EXECUTE'),'anonymous users cannot start trial');
select ok(not has_table_privilege('authenticated','private.pro_trials','INSERT'),'clients cannot manufacture or edit trial grants');
set local role authenticated;
select set_config('request.jwt.claim.sub','c1000000-0000-4000-8000-000000000002',true);
select throws_ok($$select public.start_pro_trial('c2000000-0000-4000-8000-000000000001')$$,'42501','forbidden','member cannot start trial');
select set_config('request.jwt.claim.sub','c1000000-0000-4000-8000-000000000003',true);
select throws_ok($$select public.start_pro_trial('c2000000-0000-4000-8000-000000000001')$$,'42501','forbidden','other owner cannot start trial');
select set_config('request.jwt.claim.sub','c1000000-0000-4000-8000-000000000001',true);
select is(public.get_billing_dashboard('c2000000-0000-4000-8000-000000000001')->'trial'->>'eligible','true','new owner is eligible');
select is(public.start_pro_trial('c2000000-0000-4000-8000-000000000001')->'access'->>'plan','pro','explicit activation immediately grants Pro');
select is(public.start_pro_trial('c2000000-0000-4000-8000-000000000001')->'access'->>'source','trial','retry returns same trial');
select throws_ok($$select public.start_pro_trial('c2000000-0000-4000-8000-000000000002')$$,'P0001','trial_unavailable','same owner cannot restart in a second organization');
select is(public.get_effective_entitlements('c2000000-0000-4000-8000-000000000001')->'features'->>'radar_charts','true','trial includes Pro analytics');
select ok(coalesce((public.get_effective_entitlements('c2000000-0000-4000-8000-000000000001')->'features'->>'custom_branding')::boolean,false)=false,'trial does not include Organization-only branding');
reset role;
select is((select expires_at-starts_at from private.pro_trials where organization_id='c2000000-0000-4000-8000-000000000001'),interval '168 hours','trial is exactly seven days');
select is((select count(*) from private.pro_trials),1::bigint,'activation retry created only one trial');
select is((select count(*) from public.billing_contracts where organization_id='c2000000-0000-4000-8000-000000000001'),0::bigint,'trial creates no paid subscription');
select lives_ok($$select private.require_billing_feature('c2000000-0000-4000-8000-000000000001',null,'export_reports')$$,'Pro boundary accepts active trial');
update private.pro_trials set starts_at=now()-interval '168 hours',expires_at=now() where organization_id='c2000000-0000-4000-8000-000000000001';
select is(private.effective_billing_access('c2000000-0000-4000-8000-000000000001')->>'plan','free','trial expires at exact boundary without cron');
select throws_ok($$select private.require_billing_feature('c2000000-0000-4000-8000-000000000001',null,'export_reports')$$,'42501','entitlement_required','expired trial cannot use premium feature');
select is((select count(*) from public.tryouts where id='c3000000-0000-4000-8000-000000000001'),1::bigint,'expiry preserves existing records');
set local role authenticated;
select is(public.start_pro_trial('c2000000-0000-4000-8000-000000000001')->'access'->>'plan','free','retry cannot extend expired trial');
reset role;
update private.billing_configuration set enabled=false;
set local role authenticated;
select throws_ok($$select public.start_pro_trial('c2000000-0000-4000-8000-000000000001')$$,'P0001','billing_not_enabled','staged deployment cannot activate trial');
reset role;
select * from finish();
rollback;
