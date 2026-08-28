begin;

set local search_path = extensions, public;

select plan(10);

select has_table('public'::name, 'organizations'::name, 'organizations exists');
select has_column('public'::name, 'organizations'::name, 'id'::name, 'organizations has an id');
select has_column('public'::name, 'organizations'::name, 'slug'::name, 'organizations has a slug');
select col_is_unique('public'::name, 'organizations'::name, 'slug'::name, 'organization slugs are unique');
select has_table('public'::name, 'profiles'::name, 'profiles exists');
select has_table('public'::name, 'audit_logs'::name, 'audit logs exist');
select has_column('public'::name, 'audit_logs'::name, 'organization_id'::name, 'audit logs are tenant scoped');
select has_column('public'::name, 'audit_logs'::name, 'occurred_at'::name, 'audit logs record when events occur');
select has_index('public'::name, 'audit_logs'::name, 'audit_logs_organization_id_id_key'::name, 'audit logs have a tenant composite key');
select policies_are('public'::name, 'audit_logs'::name, array[]::name[]);

select * from finish();

rollback;
