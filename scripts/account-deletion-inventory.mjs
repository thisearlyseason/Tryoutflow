// Read-only dependency inventory for a reviewed account-deletion request.
// Requires an explicitly supplied database URL. Never prints credentials or row contents.
import { spawnSync } from 'node:child_process';
const userId = process.argv[2];
if (
  !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId ?? '')
)
  throw new Error(
    'Usage: ACCOUNT_DELETION_DATABASE_URL=... node scripts/account-deletion-inventory.mjs <account-uuid>',
  );
const url = process.env.ACCOUNT_DELETION_DATABASE_URL;
if (!url) throw new Error('Explicit ACCOUNT_DELETION_DATABASE_URL is required.');
const sql = `begin read only;
set local statement_timeout='30s';
select json_build_object('database',current_database(),'user',current_user);
do $inventory$
declare dependency record; hits bigint;
begin
 for dependency in
  select n.nspname as schema_name,t.relname as table_name,a.attname as column_name,c.confdeltype as deletion_action
  from pg_constraint c join pg_class t on t.oid=c.conrelid join pg_namespace n on n.oid=t.relnamespace
  join pg_attribute a on a.attrelid=c.conrelid and a.attnum=c.conkey[1]
  where c.contype='f' and array_length(c.conkey,1)=1 and n.nspname in ('public','private')
   and c.confrelid in ('auth.users'::regclass,'public.profiles'::regclass)
 loop
  execute format('select count(*) from %I.%I where %I=$1',dependency.schema_name,dependency.table_name,dependency.column_name) into hits using '${userId}'::uuid;
  if hits>0 then raise notice '%',json_build_object('schema',dependency.schema_name,'table',dependency.table_name,'column',dependency.column_name,'rows',hits,'foreign_key_action',dependency.deletion_action); end if;
 end loop;
end $inventory$;
rollback;`;
const result = spawnSync('psql', ['-X', '-At', '-v', 'ON_ERROR_STOP=1', '--dbname', url], {
  env: process.env,
  input: sql,
  encoding: 'utf8',
  timeout: 45000,
  maxBuffer: 1024 * 1024,
});
if (result.error || result.status !== 0)
  throw new Error(
    'Inventory failed. No changes were made. ' +
      (result.stderr?.match(/^ERROR:.*$/m)?.[0] ?? 'Check database access.'),
  );
const dependencies = result.stderr.split('\n').flatMap((line) => {
  const match = line.match(/^NOTICE:\s+(\{.*\})$/);
  return match ? [JSON.parse(match[1])] : [];
});
console.log(JSON.stringify({ readOnly: true, dependencies }, null, 2));
console.log(
  'Foreign-key counts are only part of the inventory. Review email matches, audit/JSON references, storage objects, shared-organization data and downstream providers separately. No data was changed.',
);
