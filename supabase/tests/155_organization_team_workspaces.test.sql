begin;
select no_plan();
select is((select count(*) from pg_constraint where contype='f' and conrelid='public.organization_members'::regclass and confrelid='public.organizations'::regclass),1::bigint,'legacy organization membership embedding stays unambiguous');
update private.billing_configuration set enabled=true,access_enabled=true;
insert into auth.users(id,email) values
 ('e1550000-0000-4000-8000-000000000001','workspace-owner@example.test'),
 ('e1550000-0000-4000-8000-000000000002','workspace-admin@example.test'),
 ('e1550000-0000-4000-8000-000000000003','workspace-coach-a@example.test'),
 ('e1550000-0000-4000-8000-000000000004','workspace-coach-b@example.test'),
 ('e1550000-0000-4000-8000-000000000005','workspace-outsider@example.test');
insert into public.organizations(id,name,slug) values
 ('e1550000-0000-4000-8000-000000000010','Workspace club','workspace-club'),
 ('e1550000-0000-4000-8000-000000000020','Other club','workspace-other');
insert into public.organization_members(organization_id,user_id,role,status) values
 ('e1550000-0000-4000-8000-000000000010','e1550000-0000-4000-8000-000000000001','owner','active'),
 ('e1550000-0000-4000-8000-000000000010','e1550000-0000-4000-8000-000000000002','administrator','active'),
 ('e1550000-0000-4000-8000-000000000020','e1550000-0000-4000-8000-000000000005','owner','active');
create temp table workspace_ids(name text primary key,id uuid);
grant select,insert on workspace_ids to authenticated;
grant select on workspace_ids to service_role;
select ok(not has_function_privilege('anon','public.create_team_workspace(uuid,text,text)','EXECUTE'),'anonymous team creation blocked');
select ok(not has_function_privilege('authenticated','private.standalone_billing_access(uuid,uuid)','EXECUTE'),'standalone resolver is private');
set local role authenticated;
select set_config('request.jwt.claim.sub','e1550000-0000-4000-8000-000000000001',true);
select throws_ok($$select public.create_team_workspace('e1550000-0000-4000-8000-000000000010','No access','workspace-denied')$$,'42501','organization_plan_required','unpaid cannot create team');
select public.start_pro_trial('e1550000-0000-4000-8000-000000000010');
select throws_ok($$select public.create_team_workspace('e1550000-0000-4000-8000-000000000010','Trial team','workspace-denied')$$,'42501','organization_plan_required','Pro trial cannot create team');
reset role;
insert into public.billing_overrides(organization_id,product_key,reason,starts_at,expires_at) values('e1550000-0000-4000-8000-000000000010','pro_annual','Workspace test',now()-interval '1 hour',now()+interval '1 hour');
set local role authenticated;
select throws_ok($$select public.create_team_workspace('e1550000-0000-4000-8000-000000000010','Pro team','workspace-denied')$$,'42501','organization_plan_required','Pro annual cannot create team');
reset role;
update public.billing_overrides set product_key='organization_monthly' where organization_id='e1550000-0000-4000-8000-000000000010';
set local role authenticated;
update public.organizations set sport_defaults='["Hockey"]',tag_defaults='["Effort"]' where id='e1550000-0000-4000-8000-000000000010';
insert into workspace_ids values ('a',public.create_team_workspace('e1550000-0000-4000-8000-000000000010','U13 Falcons','workspace-u13'));
insert into workspace_ids values ('b',public.create_team_workspace('e1550000-0000-4000-8000-000000000010','U15 Falcons','workspace-u15'));
select is(public.create_team_workspace('e1550000-0000-4000-8000-000000000010','U13 Falcons','workspace-u13'),(select id from workspace_ids where name='a'),'exact creation retry does not duplicate team');
select is((select count(*) from public.organizations where parent_organization_id='e1550000-0000-4000-8000-000000000010'),2::bigint,'Organization monthly creates multiple teams');
select is((select sport_defaults from public.organizations where slug='workspace-u13'),'["Hockey"]'::jsonb,'team inherits shared defaults');
select is(public.get_effective_entitlements((select id from workspace_ids where name='a'))->>'plan','organization','team inherits Organization features');
select is(public.get_billing_dashboard((select id from workspace_ids where name='a'))->>'purchasesEnabled','false','team cannot start a second subscription');
select is(public.get_billing_dashboard((select id from workspace_ids where name='a'))->'trial'->>'eligible','false','team never offers a separate trial');
select throws_ok($$select public.start_pro_trial((select id from workspace_ids where name='a'))$$,'P0001','trial_unavailable','direct team trial blocked');
select throws_ok($$select public.reserve_billing_purchase(gen_random_uuid(),(select id from workspace_ids where name='a'),null,'organization_monthly','stripe')$$,'42501','billing_managed_by_organization','direct team subscription purchase blocked');
select throws_ok($$select public.create_team_workspace((select id from workspace_ids where name='a'),'Nested','workspace-nested')$$,'42501','forbidden','nested teams blocked');
select throws_ok($$update public.organizations set parent_organization_id=null where slug='workspace-u13'$$,'42501','workspace_parent_immutable','team cannot detach from paying organization');
select is(jsonb_array_length(public.get_workspace_navigation('e1550000-0000-4000-8000-000000000010')->'workspaces'),3,'owner sees organization and both teams');
reset role;
insert into public.organization_members(organization_id,user_id,role,status) values
 ((select id from workspace_ids where name='a'),'e1550000-0000-4000-8000-000000000003','administrator','active'),
 ((select id from workspace_ids where name='b'),'e1550000-0000-4000-8000-000000000004','administrator','active');
insert into public.athletes(organization_id,given_name,family_name,normalized_given_name,normalized_family_name)
 select id,'Synthetic',name,'synthetic',name from workspace_ids;
insert into public.tryouts(organization_id,name,slug,sport,timezone) select id,'Team tryout '||name,'workspace-event-'||name,'Hockey','UTC' from workspace_ids;
set local role authenticated;
select set_config('request.jwt.claim.sub','e1550000-0000-4000-8000-000000000003',true);
select is(jsonb_array_length(public.get_workspace_navigation((select id from workspace_ids where name='a'))->'workspaces'),1,'coach only sees assigned team');
select is(public.get_workspace_navigation((select id from workspace_ids where name='a'))->'parent'->>'canManage','false','coach cannot manage parent');
select is((select count(*) from public.organizations where id in (select id from workspace_ids)),1::bigint,'sibling organization RLS blocks coach');
select is((select count(*) from public.athletes where organization_id in (select id from workspace_ids)),1::bigint,'sibling athlete RLS blocks coach');
select is((select count(*) from public.tryouts where organization_id in (select id from workspace_ids)),1::bigint,'sibling tryout RLS blocks coach');
select lives_ok($$select public.load_report_summary((select id from workspace_ids where name='a'))$$,'coach can open own reports');
select is((select result->>'outcome' from public.load_report_summary((select id from workspace_ids where name='b'))),'forbidden','sibling report RPC blocked');
select throws_ok($$select public.get_effective_entitlements((select id from workspace_ids where name='b'))$$,'42501',null,'sibling entitlement RPC blocked');
select throws_ok($$select public.list_team_workspaces('e1550000-0000-4000-8000-000000000010')$$,'42501','forbidden','coach cannot read organization summary');
select throws_ok($$select public.create_team_workspace('e1550000-0000-4000-8000-000000000010','Coach escape','workspace-escape')$$,'42501','forbidden','coach cannot create sibling team');
select throws_ok($$update public.organizations set sport_defaults='["Soccer"]' where slug='workspace-u13'$$,'42501','defaults_managed_by_organization','coach cannot override shared defaults');
select lives_ok($$update public.organizations set timezone='UTC' where slug='workspace-u13'$$,'team timezone is independently editable');
select is((select count(*) from public.organization_members where organization_id='e1550000-0000-4000-8000-000000000010'),0::bigint,'coach cannot read parent members');
select set_config('request.jwt.claim.sub','e1550000-0000-4000-8000-000000000005',true);
select throws_ok($$select public.get_workspace_navigation((select id from workspace_ids where name='a'))$$,'42501','forbidden','unrelated owner cannot navigate team');
select throws_ok($$select public.list_team_workspaces('e1550000-0000-4000-8000-000000000010')$$,'42501','forbidden','unrelated owner cannot see summary');
select set_config('request.jwt.claim.sub','e1550000-0000-4000-8000-000000000002',true);
select is((select count(*) from public.athletes where organization_id in (select id from workspace_ids)),2::bigint,'parent administrator can read both teams');
select is(jsonb_array_length(public.list_team_workspaces('e1550000-0000-4000-8000-000000000010')),2,'parent administrator gets team report');
select is((public.list_team_workspaces('e1550000-0000-4000-8000-000000000010')->0->>'athletes')::int,1,'team report counts athletes accurately');
select is((public.list_team_workspaces('e1550000-0000-4000-8000-000000000010')->0->>'coaches')::int,1,'team report excludes inherited managers from coach count');
select is((select outcome from public.change_organization_member((select id from workspace_ids where name='a'),(select id from public.organization_members where organization_id=(select id from workspace_ids where name='a') and user_id='e1550000-0000-4000-8000-000000000003'),'administrator','disabled',0,gen_random_uuid())),'updated','parent administrator can revoke team coach');
select set_config('request.jwt.claim.sub','e1550000-0000-4000-8000-000000000003',true);
select is((select count(*) from public.athletes where organization_id=(select id from workspace_ids where name='a')),0::bigint,'revoked coach loses live data access');
reset role;
update public.organization_members set status='active' where organization_id=(select id from workspace_ids where name='a') and user_id='e1550000-0000-4000-8000-000000000003';
update public.organization_members set status='disabled' where organization_id='e1550000-0000-4000-8000-000000000010' and user_id='e1550000-0000-4000-8000-000000000002';
select is((select count(*) from public.organization_members where organization_id in (select id from workspace_ids) and user_id='e1550000-0000-4000-8000-000000000002' and status='active'),0::bigint,'parent administrator offboarding revokes all inherited memberships');
set local role authenticated;
select set_config('request.jwt.claim.sub','e1550000-0000-4000-8000-000000000002',true);
select is((select count(*) from public.athletes where organization_id in (select id from workspace_ids)),0::bigint,'offboarded parent administrator cannot read team data');
reset role;
update public.organization_members set status='active' where organization_id='e1550000-0000-4000-8000-000000000010' and user_id='e1550000-0000-4000-8000-000000000002';
select is((select count(*) from public.organization_members where organization_id in (select id from workspace_ids) and user_id='e1550000-0000-4000-8000-000000000002' and status='active'),2::bigint,'reactivation restores inherited access');
set local role authenticated;
select set_config('request.jwt.claim.sub','e1550000-0000-4000-8000-000000000001',true);
update public.organizations set sport_defaults='["Basketball"]' where id='e1550000-0000-4000-8000-000000000010';
select is((select count(*) from public.organizations where parent_organization_id='e1550000-0000-4000-8000-000000000010' and sport_defaults='["Basketball"]'),2::bigint,'updated defaults propagate to every team');
reset role;
select throws_ok($$update public.organization_members set status='disabled' where organization_id=(select id from workspace_ids where name='a') and user_id='e1550000-0000-4000-8000-000000000002'$$,'42501','membership_managed_by_organization','inherited authority cannot be changed inside team');
update public.billing_overrides set product_key='organization_annual' where organization_id='e1550000-0000-4000-8000-000000000010';
select is(private.effective_billing_access((select id from workspace_ids where name='a'))->>'plan','organization','annual Organization plan inherits the same team features');
update public.billing_overrides set product_key='pro_monthly' where organization_id='e1550000-0000-4000-8000-000000000010';
select is(private.effective_billing_access((select id from workspace_ids where name='a'))->>'plan','free','downgrade to Pro cannot continue inherited Organization access');
select throws_ok($$select private.require_billing_feature((select id from workspace_ids where name='a'),null,'export_reports')$$,'42501','entitlement_required','downgrade blocks premium team operations');
select is((select count(*) from public.athletes where organization_id in (select id from workspace_ids)),2::bigint,'downgrade preserves all team data');
update public.billing_overrides set product_key='organization_annual' where organization_id='e1550000-0000-4000-8000-000000000010';
select lives_ok($$select private.require_billing_feature((select id from workspace_ids where name='a'),null,'export_reports')$$,'restoring Organization restores team features');
set local role service_role;
select lives_ok($$select public.upsert_organization_logo_service('e1550000-0000-4000-8000-000000000010','e1550000-0000-4000-8000-000000000001','UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA','c90cff659645a312a28804965f3dbc34061338f7234ff5d6ddb2c57e9eadec15')$$,'parent branding saves');
select is((select sha256 from public.read_organization_logo_service('workspace-u13')),'c90cff659645a312a28804965f3dbc34061338f7234ff5d6ddb2c57e9eadec15','team logo serves parent branding');
select throws_ok($$select public.upsert_organization_logo_service((select id from workspace_ids where name='a'),'e1550000-0000-4000-8000-000000000003','UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA','c90cff659645a312a28804965f3dbc34061338f7234ff5d6ddb2c57e9eadec15')$$,'42501','branding_managed_by_organization','team cannot replace parent branding');
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub','e1550000-0000-4000-8000-000000000003',true);
select ok((select logo_exists from public.get_organization_logo_metadata((select id from workspace_ids where name='a'))),'coach receives inherited branding metadata');
select set_config('request.jwt.claim.sub','e1550000-0000-4000-8000-000000000001',true);
select throws_ok($$select public.transfer_organization_ownership((select id from workspace_ids where name='a'),(select id from public.organization_members where organization_id=(select id from workspace_ids where name='a') and user_id='e1550000-0000-4000-8000-000000000003'),(select version from public.organization_members where organization_id=(select id from workspace_ids where name='a') and user_id='e1550000-0000-4000-8000-000000000001'),(select version from public.organization_members where organization_id=(select id from workspace_ids where name='a') and user_id='e1550000-0000-4000-8000-000000000003'),gen_random_uuid())$$,'42501',null,'child ownership cannot be separated from organization');
reset role;
insert into public.organization_members(organization_id,user_id,role,status) values('e1550000-0000-4000-8000-000000000010','e1550000-0000-4000-8000-000000000005','administrator','active');
select is((select count(*) from public.organization_members where organization_id in (select id from workspace_ids) and user_id='e1550000-0000-4000-8000-000000000005' and inherited_from_organization_id='e1550000-0000-4000-8000-000000000010' and status='active'),2::bigint,'new parent administrator inherits existing teams');
update public.organization_members set role='member' where organization_id='e1550000-0000-4000-8000-000000000010' and user_id='e1550000-0000-4000-8000-000000000005';
select is((select count(*) from public.organization_members where organization_id in (select id from workspace_ids) and user_id='e1550000-0000-4000-8000-000000000005' and status='active'),0::bigint,'parent demotion removes inherited team authority');
set local role authenticated;
select set_config('request.jwt.claim.sub','e1550000-0000-4000-8000-000000000001',true);
select is((select outcome from public.transfer_organization_ownership('e1550000-0000-4000-8000-000000000010',
 (select id from public.organization_members where organization_id='e1550000-0000-4000-8000-000000000010' and user_id='e1550000-0000-4000-8000-000000000002'),
 (select version from public.organization_members where organization_id='e1550000-0000-4000-8000-000000000010' and user_id='e1550000-0000-4000-8000-000000000001'),
 (select version from public.organization_members where organization_id='e1550000-0000-4000-8000-000000000010' and user_id='e1550000-0000-4000-8000-000000000002'),gen_random_uuid())),'transferred','parent ownership transfer still works');
reset role;
select is((select count(*) from public.organization_members where organization_id in (select id from workspace_ids) and user_id='e1550000-0000-4000-8000-000000000002' and role='owner'),2::bigint,'new parent owner owns both teams');
select is((select count(*) from public.organization_members where organization_id in (select id from workspace_ids) and user_id='e1550000-0000-4000-8000-000000000001' and role='administrator'),2::bigint,'former parent owner is demoted in both teams');
insert into public.tryouts(id,organization_id,name,slug,sport,timezone) values('e1550000-0000-4000-8000-000000000099','e1550000-0000-4000-8000-000000000010','Single license','workspace-single-license','Hockey','UTC');
update public.billing_overrides set product_key='single_tryout_pro',tryout_id=(select id from public.tryouts where organization_id='e1550000-0000-4000-8000-000000000010' limit 1) where organization_id='e1550000-0000-4000-8000-000000000010';
select is(private.effective_billing_access((select id from workspace_ids where name='a'))->>'plan','free','one-time Pro cannot cover team workspaces');
set local role authenticated;
select set_config('request.jwt.claim.sub','e1550000-0000-4000-8000-000000000001',true);
select throws_ok($$select public.create_team_workspace('e1550000-0000-4000-8000-000000000010','Single extra','workspace-single-extra')$$,'42501','organization_plan_required','single tryout cannot create team');
reset role;
-- A bound single-tryout license is immutable. Revoke it and create a separate
-- expired subscription fixture rather than changing the purchased product.
update public.billing_overrides set revoked_at=now() where organization_id='e1550000-0000-4000-8000-000000000010';
insert into public.billing_overrides(organization_id,product_key,reason,starts_at,expires_at)
values('e1550000-0000-4000-8000-000000000010','organization_annual','Expired workspace test',now()-interval '1 day',now());
select is(private.effective_billing_access((select id from workspace_ids where name='a'))->>'plan','free','expired Organization cannot cover teams');
select * from finish(); rollback;
