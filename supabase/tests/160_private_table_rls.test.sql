begin;
set local search_path = extensions, public;
select plan(3);

select is((
  select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname in ('public','private') and c.relkind in ('r','p')
    and not c.relrowsecurity
), 0::bigint, 'all application tables enable row level security');

select is((
  select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
  cross join unnest(array['anon','authenticated','service_role']) caller(role_name)
  cross join unnest(array['SELECT','INSERT','UPDATE','DELETE']) access(privilege_name)
  where n.nspname='private'
    and c.relname in ('athlete_portraits','performance_exports','pro_trials','talent_record_revisions')
    and has_table_privilege(caller.role_name,c.oid,access.privilege_name)
), 0::bigint, 'private tables have no direct API-role data access');

select is((
  select count(*) from pg_policies where schemaname='private'
    and tablename in ('athlete_portraits','performance_exports','pro_trials','talent_record_revisions')
), 0::bigint, 'private tables remain default-deny with no direct caller policies');

select * from finish();
rollback;
