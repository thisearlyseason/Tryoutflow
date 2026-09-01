begin;
select plan(27);

insert into auth.users (id)
values
  ('40404040-4040-4404-8404-404040404040'),
  ('41414141-4141-4414-8414-414141414141'),
  ('42424242-4242-4424-8424-424242424242'),
  ('43434343-4343-4434-8434-434343434343'),
  ('44444444-4444-4444-8444-444444444444'),
  ('45454545-4545-4454-8454-454545454545');

insert into public.organizations (id, name, slug, timezone)
values ('46464646-4646-4464-8464-464646464646', 'Offboarding Club', 'offboarding-club', 'America/Edmonton');

insert into public.organization_members (organization_id, user_id, role, status)
values
  ('46464646-4646-4464-8464-464646464646', '40404040-4040-4404-8404-404040404040', 'owner', 'active'),
  ('46464646-4646-4464-8464-464646464646', '41414141-4141-4414-8414-414141414141', 'member', 'active'),
  ('46464646-4646-4464-8464-464646464646', '42424242-4242-4424-8424-424242424242', 'member', 'active'),
  ('46464646-4646-4464-8464-464646464646', '43434343-4343-4434-8434-434343434343', 'member', 'active'),
  ('46464646-4646-4464-8464-464646464646', '44444444-4444-4444-8444-444444444444', 'member', 'active'),
  ('46464646-4646-4464-8464-464646464646', '45454545-4545-4454-8454-454545454545', 'administrator', 'active');

insert into public.tryouts (id, organization_id, name, slug, sport, timezone, status, published_at, finalized_at, version)
values
  ('47474747-4747-4474-8474-474747474747', '46464646-4646-4464-8464-464646464646', 'Scoped Camp', 'scoped-camp', 'Hockey', 'America/Edmonton', 'draft', null, null, 0),
  ('48484848-4848-4484-8484-484848484848', '46464646-4646-4464-8464-464646464646', 'Draft Delete', 'draft-delete', 'Hockey', 'America/Edmonton', 'draft', null, null, 0),
  ('49494949-4949-4494-8494-494949494949', '46464646-4646-4464-8464-464646464646', 'Published Delete', 'published-delete', 'Hockey', 'America/Edmonton', 'published', '2026-08-28T12:00:00Z', null, 0),
  ('50505050-5050-4505-8505-505050505050', '46464646-4646-4464-8464-464646464646', 'Finalized Delete', 'finalized-delete', 'Hockey', 'America/Edmonton', 'finalized', '2026-08-28T12:00:00Z', '2026-08-28T13:00:00Z', 0),
  ('54545454-5454-4454-8454-545454545454', '46464646-4646-4464-8464-464646464646', 'Capacity Camp', 'capacity-camp', 'Hockey', 'America/Edmonton', 'draft', null, null, 1000000000);

insert into public.tryout_divisions (id, organization_id, tryout_id, name, sort_order)
values ('51515151-5151-4515-8515-515151515151', '46464646-4646-4464-8464-464646464646', '47474747-4747-4474-8474-474747474747', 'U15', 1);

insert into public.tryout_positions (id, organization_id, tryout_id, name, sort_order)
values ('56565656-5656-4656-8656-565656565656', '46464646-4646-4464-8464-464646464646', '47474747-4747-4474-8474-474747474747', 'Forward', 1);

insert into public.tryout_sessions (id, organization_id, tryout_id, division_id, name, starts_at, ends_at)
values ('52525252-5252-4525-8525-525252525252', '46464646-4646-4464-8464-464646464646', '47474747-4747-4474-8474-474747474747', '51515151-5151-4515-8515-515151515151', 'U15 session', '2026-09-10T17:00:00Z', '2026-09-10T18:00:00Z');

insert into public.session_groups (id, organization_id, tryout_id, session_id, name, sort_order)
values ('53535353-5353-4535-8535-535353535353', '46464646-4646-4464-8464-464646464646', '47474747-4747-4474-8474-474747474747', '52525252-5252-4525-8525-525252525252', 'Blue', 1);

insert into public.tryout_staff_assignments (organization_id, user_id, role, scope_kind, tryout_id, division_id, session_id, group_id, granted_by_user_id)
values
  ('46464646-4646-4464-8464-464646464646', '41414141-4141-4414-8414-414141414141', 'director', 'tryout', '47474747-4747-4474-8474-474747474747', null, null, null, '40404040-4040-4404-8404-404040404040'),
  ('46464646-4646-4464-8464-464646464646', '42424242-4242-4424-8424-424242424242', 'director', 'division', '47474747-4747-4474-8474-474747474747', '51515151-5151-4515-8515-515151515151', null, null, '40404040-4040-4404-8404-404040404040'),
  ('46464646-4646-4464-8464-464646464646', '43434343-4343-4434-8434-434343434343', 'director', 'session', '47474747-4747-4474-8474-474747474747', null, '52525252-5252-4525-8525-525252525252', null, '40404040-4040-4404-8404-404040404040'),
  ('46464646-4646-4464-8464-464646464646', '44444444-4444-4444-8444-444444444444', 'director', 'group', '47474747-4747-4474-8474-474747474747', null, '52525252-5252-4525-8525-525252525252', '53535353-5353-4535-8535-535353535353', '40404040-4040-4404-8404-404040404040');

update public.organization_members
set status = 'disabled'
where organization_id = '46464646-4646-4464-8464-464646464646'
  and user_id in ('41414141-4141-4414-8414-414141414141', '42424242-4242-4424-8424-424242424242', '43434343-4343-4434-8434-434343434343', '44444444-4444-4444-8444-444444444444');

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);

select set_config('request.jwt.claim.sub', '41414141-4141-4414-8414-414141414141', true);
select ok(not public.can_manage_tryout_root('46464646-4646-4464-8464-464646464646', '47474747-4747-4474-8474-474747474747'), 'offboarded tryout director loses root management');
select is((select count(*) from public.tryouts), 0::bigint, 'offboarded director cannot read tryout configuration');
select throws_ok($$update public.tryouts set name = 'forged root update' where id = '47474747-4747-4474-8474-474747474747'$$,'42501',null,'offboarded directors have no direct root mutation privilege');
select throws_ok($$update public.tryout_positions set name = 'forged root position update' where id = '56565656-5656-4656-8656-565656565656'$$,'42501',null,'offboarded directors have no direct position mutation privilege');
select throws_ok($$select * from public.transition_tryout_lifecycle('46464646-4646-4464-8464-464646464646', '47474747-4747-4474-8474-474747474747', 0, 'publish')$$, '42501', null, 'offboarded director cannot invoke lifecycle RPC');

select set_config('request.jwt.claim.sub', '42424242-4242-4424-8424-424242424242', true);
select ok(not public.can_manage_tryout_division('46464646-4646-4464-8464-464646464646', '47474747-4747-4474-8474-474747474747', '51515151-5151-4515-8515-515151515151'), 'offboarded division director loses division management');
select is((select count(*) from public.tryout_divisions), 0::bigint, 'offboarded division director cannot read assigned division');
select throws_ok($$update public.tryout_divisions set name = 'forged division update' where id = '51515151-5151-4515-8515-515151515151'$$,'42501',null,'offboarded directors have no direct division mutation privilege');

select set_config('request.jwt.claim.sub', '43434343-4343-4434-8434-434343434343', true);
select ok(not public.can_manage_tryout_session('46464646-4646-4464-8464-464646464646', '47474747-4747-4474-8474-474747474747', '51515151-5151-4515-8515-515151515151', '52525252-5252-4525-8525-525252525252'), 'offboarded session director loses session management');
select is((select count(*) from public.tryout_sessions), 0::bigint, 'offboarded session director cannot read assigned session');
select throws_ok($$update public.tryout_sessions set name = 'forged session update' where id = '52525252-5252-4525-8525-525252525252'$$,'42501',null,'offboarded directors have no direct session mutation privilege');

select set_config('request.jwt.claim.sub', '44444444-4444-4444-8444-444444444444', true);
select ok(not public.can_manage_session_group('46464646-4646-4464-8464-464646464646', '47474747-4747-4474-8474-474747474747', '52525252-5252-4525-8525-525252525252', '53535353-5353-4535-8535-535353535353'), 'offboarded group director loses group management');
select is((select count(*) from public.session_groups), 0::bigint, 'offboarded group director cannot read assigned group');
select throws_ok($$update public.session_groups set name = 'forged group update' where id = '53535353-5353-4535-8535-535353535353'$$,'42501',null,'offboarded directors have no direct group mutation privilege');
reset role;

select is((select name from public.tryouts where id = '47474747-4747-4474-8474-474747474747'), 'Scoped Camp', 'offboarded root mutation was not persisted');
select is((select name from public.tryout_positions where id = '56565656-5656-4656-8656-565656565656'), 'Forward', 'offboarded root position mutation was not persisted');
select is((select name from public.tryout_divisions where id = '51515151-5151-4515-8515-515151515151'), 'U15', 'offboarded division mutation was not persisted');
select is((select name from public.tryout_sessions where id = '52525252-5252-4525-8525-525252525252'), 'U15 session', 'offboarded session mutation was not persisted');
select is((select name from public.session_groups where id = '53535353-5353-4535-8535-535353535353'), 'Blue', 'offboarded group mutation was not persisted');

set local role authenticated;
select set_config('request.jwt.claim.sub', '40404040-4040-4404-8404-404040404040', true);
select throws_ok(
  $$update public.tryouts set name = 'capacity write' where id = '54545454-5454-4454-8454-545454545454'$$,
  '42501',
  null,
  'direct draft writes are unavailable before any version counter is reached'
);
select is(
  (select outcome from public.transition_tryout_lifecycle('46464646-4646-4464-8464-464646464646', '54545454-5454-4454-8454-545454545454', 1000000000, 'publish')),
  'conflict',
  'lifecycle transition reports a deterministic conflict before version capacity is exceeded'
);
select throws_ok($$delete from public.tryouts where id = '48484848-4848-4484-8484-484848484848'$$,'42501',null,'owners have no direct destructive tryout path');
reset role;
select is((select count(*) from public.tryouts where id = '48484848-4848-4484-8484-484848484848'), 1::bigint, 'draft tryout remains after direct deletion is denied');

set local role authenticated;
select set_config('request.jwt.claim.sub', '45454545-4545-4454-8454-454545454545', true);
select throws_ok($$delete from public.tryouts where id = '49494949-4949-4494-8494-494949494949'$$,'42501',null,'published tryout deletion has no direct table path');
reset role;
select is((select count(*) from public.tryouts where id = '49494949-4949-4494-8494-494949494949'), 1::bigint, 'published tryout and its configuration are preserved');

set local role authenticated;
select set_config('request.jwt.claim.sub', '45454545-4545-4454-8454-454545454545', true);
select throws_ok($$delete from public.tryouts where id = '50505050-5050-4505-8505-505050505050'$$,'42501',null,'finalized tryout deletion has no direct table path');
reset role;
select is((select count(*) from public.tryouts where id = '50505050-5050-4505-8505-505050505050'), 1::bigint, 'finalized tryout and its configuration are preserved');

select * from finish();
rollback;
