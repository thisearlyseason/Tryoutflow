/** Local-only additive migration replay. All DDL, fixtures and assertions roll back. */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const files = readdirSync('supabase/migrations')
  .filter((name) => /^2026091501(1[9]|[23][0-9])_/.test(name))
  .sort();
const sql = files.map((name) => readFileSync(`supabase/migrations/${name}`, 'utf8')).join('\n');
const names = [
  ...sql.matchAll(/create\s+(?:or\s+replace\s+)?function\s+(public|private)\.([a-z_]+)/gi),
].map((m) => `${m[1]}.${m[2]}`);
const tables = [
  ...new Set(
    [...sql.matchAll(/create\s+table\s+(public|private)\.([a-z_]+)/gi)].map(
      (m) => `${m[1]}.${m[2]}`,
    ),
  ),
];
const literals = [...new Set(names)].map((n) => `'${n}'`).join(',');
const dropFunctions = `do $$declare r record;begin for r in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname||'.'||p.proname in (${literals}) loop execute 'drop function if exists '||r.signature||' cascade'; end loop;end;$$;`;
const tests = readFileSync('supabase/tests/119_talent_platform.test.sql', 'utf8')
  .replace(/^\s*begin\s*;/im, '')
  .replace(/^\s*rollback\s*;/im, '');
const replay = `begin;\nset local lock_timeout='5s';\n${dropFunctions}\ndrop table if exists ${tables.join(',')} cascade;\n${sql}\n${tests}\nrollback;\n`;
writeFileSync('output/professional-platform/replay-migrations.sql', replay);
const result = spawnSync(
  'docker',
  [
    'exec',
    '-i',
    'supabase_db_tryoutflow',
    'psql',
    '-X',
    '-U',
    'postgres',
    '-d',
    'postgres',
    '-v',
    'ON_ERROR_STOP=1',
  ],
  { input: replay, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 },
);
const log = (result.stdout ?? '') + '\n' + (result.stderr ?? '');
writeFileSync('output/professional-platform/migration-replay.log', log);
if (result.status !== 0 || /^\s*not ok\b/m.test(log) || !/^ROLLBACK$/m.test(log)) {
  console.error('Migration replay failed. See output/professional-platform/migration-replay.log');
  process.exit(1);
}
console.log(
  `Replayed ${files.length} additive migrations with rollback; ${[...log.matchAll(/^\s*ok \d+/gm)].length} database checks passed.`,
);
