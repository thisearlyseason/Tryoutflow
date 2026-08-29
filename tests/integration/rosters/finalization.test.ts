// @vitest-environment node

import { execFile as execFileCallback, execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const execFile = promisify(execFileCallback);
const primaryDatabaseUrl =
  process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const isolatedDatabaseName = `tryoutflow_roster_${randomUUID().replaceAll('-', '')}`;
const databaseUrl = primaryDatabaseUrl.replace(/\/[^/]+$/u, `/${isolatedDatabaseName}`);

beforeAll(() => {
  execFileSync(
    'psql',
    [
      primaryDatabaseUrl,
      '-v',
      'ON_ERROR_STOP=1',
      '-c',
      `drop database if exists ${isolatedDatabaseName} with (force)`,
    ],
    { stdio: 'pipe' },
  );
  execFileSync(
    'psql',
    [primaryDatabaseUrl, '-v', 'ON_ERROR_STOP=1', '-c', `create database ${isolatedDatabaseName}`],
    { stdio: 'pipe' },
  );
  execFileSync(
    'psql',
    [
      databaseUrl,
      '-v',
      'ON_ERROR_STOP=1',
      '-c',
      `
        drop schema public;
        create schema auth;
        create schema extensions;
        create table auth.users(id uuid primary key,email text);
        create function auth.uid() returns uuid language sql stable as
          'select nullif(current_setting(''request.jwt.claim.sub'',true),'''')::uuid';
        create function auth.role() returns text language sql stable as
          'select nullif(current_setting(''request.jwt.claim.role'',true),'''')';
        create function auth.jwt() returns jsonb language sql stable as
          'select coalesce(nullif(current_setting(''request.jwt.claims'',true),'''')::jsonb,''{}''::jsonb)';
        create extension citext with schema extensions;
        create extension pgcrypto with schema extensions;
        create extension "uuid-ossp" with schema extensions;
      `,
    ],
    { stdio: 'pipe' },
  );
  const databaseContainer = execFileSync(
    'docker',
    ['ps', '--filter', 'name=supabase_db_', '--format', '{{.Names}}'],
    { encoding: 'utf8' },
  )
    .trim()
    .split('\n')[0];
  if (!databaseContainer) throw new Error('local Supabase database container not found');
  const schema = execFileSync(
    'docker',
    [
      'exec',
      databaseContainer,
      'pg_dump',
      '-U',
      'postgres',
      '-d',
      'postgres',
      '--schema-only',
      '--no-owner',
      '--schema=public',
      '--schema=private',
    ],
    { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 },
  )
    .split('\n')
    .filter((line) => !line.startsWith('ALTER DEFAULT PRIVILEGES'))
    .join('\n');
  execFileSync('psql', [databaseUrl, '-v', 'ON_ERROR_STOP=1'], {
    input: schema,
    maxBuffer: 50 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
});

afterAll(() => {
  execFileSync(
    'psql',
    [
      primaryDatabaseUrl,
      '-v',
      'ON_ERROR_STOP=1',
      '-c',
      `drop database if exists ${isolatedDatabaseName} with (force)`,
    ],
    { stdio: 'pipe' },
  );
  expect(
    execFileSync(
      'psql',
      [
        primaryDatabaseUrl,
        '-At',
        '-c',
        `select count(*) from pg_database where datname='${isolatedDatabaseName}'`,
      ],
      { encoding: 'utf8' },
    ).trim(),
  ).toBe('0');
  expect(
    execFileSync(
      'psql',
      [
        primaryDatabaseUrl,
        '-At',
        '-c',
        "select count(*) from public.organizations where slug like 'roster-race-%'",
      ],
      { encoding: 'utf8' },
    ).trim(),
  ).toBe('0');
});
const psql = (sql: string, applicationName = 'tryoutflow-roster-integration') =>
  execFile('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-At', databaseUrl, '-c', sql], {
    env: { ...process.env, PGAPPNAME: applicationName },
  });
const startSession = (applicationName: string) =>
  spawn('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-At', databaseUrl], {
    env: { ...process.env, PGAPPNAME: applicationName },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
const waitForOutput = (child: ReturnType<typeof spawn>, expected: string) =>
  new Promise<void>((resolve, reject) => {
    let output = '';
    let error = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      output += chunk.toString();
      if (output.includes(expected)) resolve();
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      error += chunk.toString();
    });
    child.once('exit', (code) => {
      if (!output.includes(expected)) reject(new Error(`psql exited ${code}: ${error}`));
    });
  });
const waitForBlockingEdge = async (blockedName: string, blockerName: string) => {
  for (let attempt = 0; attempt < 150; attempt += 1) {
    const result = await psql(`
      select waiting.locktype||'|'||waiting.mode
      from pg_stat_activity blocked
      join pg_stat_activity blocker on blocker.application_name='${blockerName}'
      join pg_locks waiting on waiting.pid=blocked.pid and not waiting.granted
      where blocked.application_name='${blockedName}'
        and blocker.pid=any(pg_blocking_pids(blocked.pid))
      order by waiting.locktype,waiting.mode limit 1
    `);
    if (result.stdout.trim()) return result.stdout.trim();
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`${blockedName} was not blocked by ${blockerName}`);
};

describe('real roster finalization concurrency', () => {
  it('serializes stale moves and creates one revision from simultaneous requests', async () => {
    const id = () => randomUUID();
    const owner = id();
    const organization = id();
    const tryout = id();
    const division = id();
    const form = id();
    const formVersion = id();
    const athleteA = id();
    const athleteB = id();
    const registrationA = id();
    const registrationB = id();
    const suffix = organization.slice(0, 8);
    const gateKey =
      Number.parseInt(organization.replaceAll('-', '').slice(0, 8), 16) % 2_147_483_647;
    const holderName = `roster-holder-${suffix}`;
    const firstMoveName = `roster-move-a-${suffix}`;
    const secondMoveName = `roster-move-b-${suffix}`;
    const holder = startSession(holderName);
    const asOwner = (sql: string, applicationName: string) =>
      psql(
        `begin; set local statement_timeout='10s'; set local role authenticated; select set_config('request.jwt.claim.sub','${owner}',true); create temporary table rpc_result on commit preserve rows as ${sql}; commit; select * from rpc_result;`,
        applicationName,
      );

    try {
      await psql(`
        insert into auth.users(id) values('${owner}');
        insert into public.organizations(id,name,slug) values('${organization}','Roster Race','roster-race-${suffix}');
        insert into public.organization_members(organization_id,user_id,role,status) values('${organization}','${owner}','owner','active');
        insert into public.tryouts(id,organization_id,name,slug,sport,timezone) values('${tryout}','${organization}','Roster Race','roster-race-${suffix}','Hockey','America/Edmonton');
        insert into public.tryout_divisions(id,organization_id,tryout_id,name,sort_order) values('${division}','${organization}','${tryout}','U15',0);
        insert into public.registration_forms(id,organization_id,tryout_id,name) values('${form}','${organization}','${tryout}','Form');
        insert into public.registration_form_versions(id,organization_id,tryout_id,registration_form_id,version_number,schema,status,published_at)
          values('${formVersion}','${organization}','${tryout}','${form}',1,'{"fields":[]}','published',clock_timestamp());
        insert into public.athletes(id,organization_id,given_name,family_name,normalized_given_name,normalized_family_name,birth_date) values
          ('${athleteA}','${organization}','Ava','One','ava','one','2012-01-01'),
          ('${athleteB}','${organization}','Mia','Two','mia','two','2012-01-02');
        insert into public.tryout_registrations(id,organization_id,tryout_id,athlete_id,division_id,registration_form_version_id,responses,submission_key_digest,submission_digest) values
          ('${registrationA}','${organization}','${tryout}','${athleteA}','${division}','${formVersion}','{}',repeat('a',64),repeat('1',64)),
          ('${registrationB}','${organization}','${tryout}','${athleteB}','${division}','${formVersion}','{}',repeat('b',64),repeat('2',64));
        update public.tryouts set status='published',published_at=clock_timestamp() where id='${tryout}';
      `);
      if (process.env.TRYOUTFLOW_ROSTER_FORCE_FAILURE === '1') {
        throw new Error('forced roster fixture failure');
      }
      const created = await asOwner(
        `select outcome||'|'||roster_version_id||'|'||version from public.create_roster_draft('${organization}','${tryout}','${division}','[{"name":"Blue"},{"name":"White"}]')`,
        `roster-create-${suffix}`,
      );
      const [, rosterId] = created.stdout.trim().split('|');
      if (!rosterId) throw new Error(`unexpected create output: ${JSON.stringify(created.stdout)}`);
      expect(rosterId).toMatch(/[0-9a-f-]{36}/u);
      const teams = (
        await psql(
          `select string_agg(id::text,',' order by sort_order) from public.tryout_teams where organization_id='${organization}'`,
        )
      ).stdout
        .trim()
        .split(',');

      holder.stdin?.write(`select pg_advisory_lock(${gateKey}); select 'gate_ready';\n`);
      await waitForOutput(holder, 'gate_ready');
      const firstMove = psql(
        `begin; set local statement_timeout='10s'; set local role authenticated; select set_config('request.jwt.claim.sub','${owner}',true); create temporary table rpc_result on commit preserve rows as select outcome||'|'||version from public.move_roster_athlete('${organization}','${tryout}','${division}','${rosterId}','${registrationA}','${teams[0]}',1); select pg_advisory_lock(${gateKey}); commit; select * from rpc_result;`,
        firstMoveName,
      );
      expect(await waitForBlockingEdge(firstMoveName, holderName)).toMatch(/advisory/u);
      const secondMove = asOwner(
        `select outcome||'|'||version from public.move_roster_athlete('${organization}','${tryout}','${division}','${rosterId}','${registrationB}','${teams[1]}',1)`,
        secondMoveName,
      );
      expect(await waitForBlockingEdge(secondMoveName, firstMoveName)).toMatch(
        /transactionid|tuple/u,
      );
      holder.stdin?.write(`select pg_advisory_unlock(${gateKey});\n\\q\n`);
      const moves = await Promise.all([firstMove, secondMove]);
      expect(moves.map((result) => result.stdout.trim().split('|')[0]).sort()).toEqual([
        'conflict',
        'moved',
      ]);
      expect(
        (
          await psql(
            `select version||'|'||(select count(*) from public.roster_assignments where roster_version_id='${rosterId}') from public.roster_versions where id='${rosterId}'`,
          )
        ).stdout.trim(),
      ).toBe('2|1');

      const finalized = await asOwner(
        `select outcome||'|'||version from public.finalize_roster_version('${organization}','${tryout}','${division}','${rosterId}',2,'FINALIZE ROSTER')`,
        `roster-finalize-${suffix}`,
      );
      expect(finalized.stdout.trim()).toBe('finalized|3');
      const revisions = await Promise.all([
        asOwner(
          `select outcome from public.revise_roster_version('${organization}','${tryout}','${division}','${rosterId}',3,'First simultaneous correction request.','REVISE ROSTER')`,
          `roster-revise-a-${suffix}`,
        ),
        asOwner(
          `select outcome from public.revise_roster_version('${organization}','${tryout}','${division}','${rosterId}',3,'Second simultaneous correction request.','REVISE ROSTER')`,
          `roster-revise-b-${suffix}`,
        ),
      ]);
      expect(revisions.map((result) => result.stdout.trim()).sort()).toEqual([
        'conflict',
        'revised',
      ]);
      expect(
        (
          await psql(
            `select count(*) filter(where state='draft')||'|'||count(*) filter(where state='finalized')||'|'||count(*) from public.roster_versions where organization_id='${organization}'`,
          )
        ).stdout.trim(),
      ).toBe('1|1|2');
      expect(
        (
          await psql(
            `select count(*) from public.audit_logs where organization_id='${organization}' and action='roster.revised'`,
          )
        ).stdout.trim(),
      ).toBe('1');
      expect(
        (
          await psql(
            `select based_on_roster_version_id||'|'||(select count(*) from public.roster_assignments assignment where assignment.roster_version_id=version.id)||'|'||(select count(*) from public.roster_decisions decision where decision.roster_version_id=version.id)||'|'||version.version from public.roster_versions version where organization_id='${organization}' and state='draft'`,
          )
        ).stdout.trim(),
      ).toBe(`${rosterId}|1|2|1`);
    } finally {
      await psql(
        `select pg_terminate_backend(pid) from pg_stat_activity where pid<>pg_backend_pid() and datname=current_database() and application_name like 'roster-%-${suffix}'`,
        `roster-cleanup-${suffix}`,
      );
    }
  }, 30_000);
});
