begin;

set local search_path = extensions, public;

select plan(16);

select has_table('public'::name, 'organizations'::name, 'organizations exists');
select has_column('public'::name, 'organizations'::name, 'id'::name, 'organizations has an id');
select has_column('public'::name, 'organizations'::name, 'slug'::name, 'organizations has a slug');
select col_is_unique('public'::name, 'organizations'::name, 'slug'::name, 'organization slugs are unique');
select has_table('public'::name, 'profiles'::name, 'profiles exists');
select has_table('public'::name, 'audit_logs'::name, 'audit logs exist');
select has_column('public'::name, 'audit_logs'::name, 'organization_id'::name, 'audit logs are tenant scoped');
select has_column('public'::name, 'audit_logs'::name, 'occurred_at'::name, 'audit logs record when events occur');
select has_index('public'::name, 'audit_logs'::name, 'audit_logs_organization_id_id_key'::name, 'audit logs have a tenant composite key');
select policies_are(
  'public'::name,
  'audit_logs'::name,
  array['audit_logs_select_administrator']::name[],
  'audit logs are visible only to organization administrators'
);
select ok((select relrowsecurity from pg_class where oid = 'public.profiles'::regclass), 'profiles have row level security enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.organizations'::regclass), 'organizations have row level security enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.audit_logs'::regclass), 'audit logs have row level security enabled');
select throws_ok(
  $$insert into public.organizations (name, slug) values ('Invalid slug', 'Invalid_Slug')$$,
  '23514',
  null,
  'organization slugs reject uppercase and underscores'
);

insert into public.organizations (id, name, slug)
values ('11111111-1111-4111-8111-111111111111', 'Audit test organization', 'audit-test-organization');

insert into public.audit_logs (id, organization_id, action, entity_type, entity_id)
values (
  '22222222-2222-4222-8222-222222222222',
  '11111111-1111-4111-8111-111111111111',
  'organization.created',
  'organization',
  '11111111-1111-4111-8111-111111111111'
);

select throws_ok(
  $$update public.audit_logs set action = 'organization.changed' where id = '22222222-2222-4222-8222-222222222222'$$,
  '55000',
  'audit_logs are append-only',
  'audit logs reject updates'
);
select throws_ok(
  $$delete from public.audit_logs where id = '22222222-2222-4222-8222-222222222222'$$,
  '55000',
  'audit_logs are append-only',
  'audit logs reject deletes'
);

select * from finish();

rollback;
