begin;
select plan(16);

insert into auth.users (id) values
  ('90909090-9090-4090-8090-909090909090'),
  ('91919191-9191-4191-8191-919191919191'),
  ('92929292-9292-4292-8292-929292929292'),
  ('93939393-9393-4393-8393-939393939393'),
  ('94949494-9494-4494-8494-949494949494'),
  ('a6a6a6a6-a6a6-46a6-86a6-a6a6a6a6a6a6');

insert into public.organizations (id, name, slug, timezone) values
  ('95959595-9595-4595-8595-959595959595', 'Rubric Security', 'rubric-security', 'America/Edmonton'),
  ('96969696-9696-4696-8696-969696969696', 'Outside Club', 'outside-club', 'America/Edmonton');
insert into public.organization_members (organization_id, user_id, role, status) values
  ('95959595-9595-4595-8595-959595959595', '90909090-9090-4090-8090-909090909090', 'owner', 'active'),
  ('95959595-9595-4595-8595-959595959595', '91919191-9191-4191-8191-919191919191', 'member', 'active'),
  ('95959595-9595-4595-8595-959595959595', '92929292-9292-4292-8292-929292929292', 'member', 'active'),
  ('95959595-9595-4595-8595-959595959595', '94949494-9494-4494-8494-949494949494', 'member', 'disabled'),
  ('95959595-9595-4595-8595-959595959595', 'a6a6a6a6-a6a6-46a6-86a6-a6a6a6a6a6a6', 'member', 'active'),
  ('96969696-9696-4696-8696-969696969696', '93939393-9393-4393-8393-939393939393', 'owner', 'active');
insert into public.tryouts (id, organization_id, name, slug, sport, timezone)
values ('97979797-9797-4797-8797-979797979797', '95959595-9595-4595-8595-959595959595', 'Security Camp', 'security-camp', 'Hockey', 'America/Edmonton');
insert into public.tryout_staff_assignments (organization_id, user_id, role, scope_kind, tryout_id, granted_by_user_id) values
  ('95959595-9595-4595-8595-959595959595', '91919191-9191-4191-8191-919191919191', 'evaluator', 'tryout', '97979797-9797-4797-8797-979797979797', '90909090-9090-4090-8090-909090909090'),
  ('95959595-9595-4595-8595-959595959595', '92929292-9292-4292-8292-929292929292', 'reviewer', 'tryout', '97979797-9797-4797-8797-979797979797', '90909090-9090-4090-8090-909090909090'),
  ('95959595-9595-4595-8595-959595959595', '94949494-9494-4494-8494-949494949494', 'evaluator', 'tryout', '97979797-9797-4797-8797-979797979797', '90909090-9090-4090-8090-909090909090'),
  ('95959595-9595-4595-8595-959595959595', 'a6a6a6a6-a6a6-46a6-86a6-a6a6a6a6a6a6', 'evaluator', 'tryout', '97979797-9797-4797-8797-979797979797', '90909090-9090-4090-8090-909090909090');
update public.tryout_staff_assignments set revoked_at = now()
where organization_id = '95959595-9595-4595-8595-959595959595'
  and user_id = 'a6a6a6a6-a6a6-46a6-86a6-a6a6a6a6a6a6';

insert into public.registration_forms (id, organization_id, tryout_id, name) values
  ('98989898-9898-4898-8898-989898989898', '95959595-9595-4595-8595-959595959595', '97979797-9797-4797-8797-979797979797', 'Default'),
  ('99999999-9999-4999-8999-999999999999', '95959595-9595-4595-8595-959595959595', '97979797-9797-4797-8797-979797979797', 'Capacity form');
select throws_ok($$insert into public.registration_form_versions (organization_id, tryout_id, registration_form_id, version_number, schema) values ('95959595-9595-4595-8595-959595959595', '97979797-9797-4797-8797-979797979797', '98989898-9898-4898-8898-989898989898', 1, '{"fields":[],"unknown":true}')$$, '23514', null, 'registration schemas reject unknown root keys');
select throws_ok($$insert into public.registration_form_versions (organization_id, tryout_id, registration_form_id, version_number, schema) values ('95959595-9595-4595-8595-959595959595', '97979797-9797-4797-8797-979797979797', '98989898-9898-4898-8898-989898989898', 1, '{"fields":[{"key":true,"label":"Name","kind":"text","required":false,"sortOrder":"0"}]}')$$, '23514', null, 'registration schemas require exact JSON field types');
select throws_ok($$insert into public.registration_form_versions (organization_id, tryout_id, registration_form_id, version_number, schema) values ('95959595-9595-4595-8595-959595959595', '97979797-9797-4797-8797-979797979797', '98989898-9898-4898-8898-989898989898', 1, jsonb_build_object('fields', (select jsonb_agg(jsonb_build_object('key', 'field_' || value, 'label', 'Field', 'kind', 'text', 'required', false, 'sortOrder', value)) from generate_series(0, 100) as value)))$$, '23514', null, 'registration schemas cap fields at one hundred');

insert into public.registration_form_versions (id, organization_id, tryout_id, registration_form_id, version_number, schema, status, published_at)
values ('a0a0a0a0-a0a0-40a0-80a0-a0a0a0a0a0a0', '95959595-9595-4595-8595-959595959595', '97979797-9797-4797-8797-979797979797', '99999999-9999-4999-8999-999999999999', 1000000000, '{"fields":[]}', 'published', now());

insert into public.rubrics (id, organization_id, tryout_id, name) values
  ('a1a1a1a1-a1a1-41a1-81a1-a1a1a1a1a1a1', '95959595-9595-4595-8595-959595959595', '97979797-9797-4797-8797-979797979797', 'Security rubric'),
  ('a2a2a2a2-a2a2-42a2-82a2-a2a2a2a2a2a2', '95959595-9595-4595-8595-959595959595', '97979797-9797-4797-8797-979797979797', 'Capacity rubric');
insert into public.rubric_versions (id, organization_id, tryout_id, rubric_id, version_number)
values ('a3a3a3a3-a3a3-43a3-83a3-a3a3a3a3a3a3', '95959595-9595-4595-8595-959595959595', '97979797-9797-4797-8797-979797979797', 'a1a1a1a1-a1a1-41a1-81a1-a1a1a1a1a1a1', 1);
insert into public.rubric_categories (id, organization_id, tryout_id, rubric_version_id, name, sort_order, weight, scale_min, scale_max)
values ('a4a4a4a4-a4a4-44a4-84a4-a4a4a4a4a4a4', '95959595-9595-4595-8595-959595959595', '97979797-9797-4797-8797-979797979797', 'a3a3a3a3-a3a3-43a3-83a3-a3a3a3a3a3a3', 'Skating', 0, 100, 1, 5);
update public.rubric_versions set status = 'published', published_at = now() where id = 'a3a3a3a3-a3a3-43a3-83a3-a3a3a3a3a3a3';
insert into public.rubric_versions (id, organization_id, tryout_id, rubric_id, version_number, status, published_at)
values ('a5a5a5a5-a5a5-45a5-85a5-a5a5a5a5a5a5', '95959595-9595-4595-8595-959595959595', '97979797-9797-4797-8797-979797979797', 'a2a2a2a2-a2a2-42a2-82a2-a2a2a2a2a2a2', 1000000000, 'published', now());

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '90909090-9090-4090-8090-909090909090', true);
select is((select outcome from public.create_rubric_revision('95959595-9595-4595-8595-959595959595', 'a2a2a2a2-a2a2-42a2-82a2-a2a2a2a2a2a2', 'a5a5a5a5-a5a5-45a5-85a5-a5a5a5a5a5a5')), 'capacity', 'rubric revision reports capacity before version overflow');
select is((select outcome from public.create_registration_form_revision('95959595-9595-4595-8595-959595959595', '99999999-9999-4999-8999-999999999999', 'a0a0a0a0-a0a0-40a0-80a0-a0a0a0a0a0a0')), 'capacity', 'form revision reports capacity before version overflow');

select set_config('request.jwt.claim.sub', '91919191-9191-4191-8191-919191919191', true);
select is((select count(*) from public.rubric_categories), 1::bigint, 'an assigned evaluator can read rubric categories');
select throws_ok($$update public.rubric_categories set name = 'forged evaluator write' where id = 'a4a4a4a4-a4a4-44a4-84a4-a4a4a4a4a4a4'$$,'42501',null,'an evaluator has no direct category-write privilege');
select set_config('request.jwt.claim.sub', '92929292-9292-4292-8292-929292929292', true);
select is((select count(*) from public.rubric_categories), 0::bigint, 'a reviewer cannot browse draft or published operational rubric configuration');
select throws_ok($$delete from public.rubric_categories where id = 'a4a4a4a4-a4a4-44a4-84a4-a4a4a4a4a4a4'$$,'42501',null,'a reviewer has no direct category-delete privilege');
select set_config('request.jwt.claim.sub', '93939393-9393-4393-8393-939393939393', true);
select is((select count(*) from public.rubrics), 0::bigint, 'a cross-tenant user cannot read rubric identities');
select throws_ok($$update public.rubrics set name = 'forged cross tenant write' where id = 'a1a1a1a1-a1a1-41a1-81a1-a1a1a1a1a1a1'$$,'42501',null,'a cross-tenant user has no direct rubric-write privilege');
select set_config('request.jwt.claim.sub', '94949494-9494-4494-8494-949494949494', true);
select is((select count(*) from public.rubric_versions), 0::bigint, 'an inactive member cannot read rubric versions');
select throws_ok($$update public.rubric_categories set name = 'forged inactive write' where id = 'a4a4a4a4-a4a4-44a4-84a4-a4a4a4a4a4a4'$$,'42501',null,'an inactive member has no direct category-write privilege');
select set_config('request.jwt.claim.sub', 'a6a6a6a6-a6a6-46a6-86a6-a6a6a6a6a6a6', true);
select is((select count(*) from public.rubric_categories), 0::bigint, 'a revoked evaluator cannot read rubric categories');
select throws_ok($$update public.rubric_categories set name = 'forged revoked write' where id = 'a4a4a4a4-a4a4-44a4-84a4-a4a4a4a4a4a4'$$,'42501',null,'a revoked evaluator has no direct category-write privilege');
reset role;
select is((select name from public.rubric_categories where id = 'a4a4a4a4-a4a4-44a4-84a4-a4a4a4a4a4a4'), 'Skating', 'unauthorized direct mutations leave categories unchanged');

select * from finish();
rollback;
