// @vitest-environment node

import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const primaryDatabaseUrl =
  process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const isolatedDatabaseName = `tryoutflow_csv_${randomUUID().replaceAll('-', '')}`;
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
        "select count(*) from public.organizations where slug like 'csv-import-fixture-%'",
      ],
      { encoding: 'utf8' },
    ).trim(),
  ).toBe('0');
});

function psql(sql: string) {
  return execFileSync('psql', [databaseUrl, '-v', 'ON_ERROR_STOP=1', '-At'], {
    encoding: 'utf8',
    input: sql,
  }).trim();
}

function psqlAsync(sql: string, onOutput?: (output: string) => void) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn('psql', [databaseUrl, '-v', 'ON_ERROR_STOP=1', '-At'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let output = '';
    let errors = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      output += chunk;
      onOutput?.(output);
    });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (errors += chunk));
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve(output.trim()) : reject(new Error(errors || `psql exited ${code}`)),
    );
    child.stdin.end(sql);
  });
}

describe('athlete CSV import transaction against local Supabase', () => {
  it('binds preview to actor and replays the exact commit without duplicate rows', () => {
    const output = psql(`
      begin;
      insert into auth.users(id) values ('16161616-1616-4616-8616-161616161616');
      insert into public.organizations(id,name,slug,timezone) values ('a1616161-1616-4616-8616-161616161616','Integration Import','integration-import','America/Edmonton');
      insert into public.organization_members(organization_id,user_id,role,status) values ('a1616161-1616-4616-8616-161616161616','16161616-1616-4616-8616-161616161616','owner','active');
      set local role authenticated;
      select set_config('request.jwt.claim.role','authenticated',true);
      select set_config('request.jwt.claim.sub','16161616-1616-4616-8616-161616161616',true);
      create temporary table p as select * from public.create_athlete_import_preview(
        'a1616161-1616-4616-8616-161616161616',repeat('e',64),
        '{"givenName":"First","familyName":"Last","birthDate":"DOB"}',
        '[{"row":2,"status":"valid","errors":[],"athlete":{"givenName":"Éva","familyName":" Nguyen ","birthDate":"2012-02-29"},"duplicateCandidateIds":[]}]'
      );
      select outcome from public.commit_athlete_import('a1616161-1616-4616-8616-161616161616',(select preview_id from p),array[2]);
      select outcome from public.commit_athlete_import('a1616161-1616-4616-8616-161616161616',(select preview_id from p),array[2]);
      select count(*)||':'||min(family_name) from public.athletes where organization_id='a1616161-1616-4616-8616-161616161616';
      rollback;
    `);
    expect(
      output.split('\n').filter((line) => ['committed', 'replayed', '1:Nguyen'].includes(line)),
    ).toEqual(['committed', 'replayed', '1:Nguyen']);
  });

  it('rejects a forged valid status and leaves the batch empty', () => {
    const output = psql(`
      begin;
      insert into auth.users(id) values ('17171717-1717-4717-8717-171717171717');
      insert into public.organizations(id,name,slug,timezone) values ('a1717171-1717-4717-8717-171717171717','Rollback Import','rollback-import','America/Edmonton');
      insert into public.organization_members(organization_id,user_id,role,status) values ('a1717171-1717-4717-8717-171717171717','17171717-1717-4717-8717-171717171717','administrator','active');
      set local role authenticated;
      select set_config('request.jwt.claim.role','authenticated',true);
      select set_config('request.jwt.claim.sub','17171717-1717-4717-8717-171717171717',true);
      create temporary table p as select * from public.create_athlete_import_preview(
        'a1717171-1717-4717-8717-171717171717',repeat('f',64),
        '{"givenName":"First","familyName":"Last","birthDate":"DOB"}',
        '[{"row":2,"status":"valid","errors":[],"athlete":{"givenName":"Valid","familyName":"Row","birthDate":"2012-01-01"},"duplicateCandidateIds":[]},{"row":3,"status":"valid","errors":[],"athlete":{"givenName":"Bad","familyName":"Date","birthDate":"2023-02-29"},"duplicateCandidateIds":[]}]'
      );
      select outcome from public.commit_athlete_import('a1717171-1717-4717-8717-171717171717',(select preview_id from p),array[2,3]);
      select count(*) from public.athletes where organization_id='a1717171-1717-4717-8717-171717171717';
      rollback;
    `);
    expect(output.split('\n').filter((line) => ['invalid_selection', '0'].includes(line))).toEqual([
      'invalid_selection',
      '0',
    ]);
  });

  async function runConcurrencyScenario() {
    const userId = randomUUID();
    const organizationId = randomUUID();
    const slug = `csv-import-fixture-${organizationId}`;
    try {
      const setup = psql(`
      insert into auth.users(id) values ('${userId}');
      insert into public.organizations(id,name,slug,timezone) values ('${organizationId}','Concurrent Import','${slug}','America/Edmonton');
      insert into public.organization_members(organization_id,user_id,role,status) values ('${organizationId}','${userId}','owner','active');
      set role authenticated;
      select set_config('request.jwt.claim.role','authenticated',false);
      select set_config('request.jwt.claim.sub','${userId}',false);
      select preview_id from public.create_athlete_import_preview(
        '${organizationId}',repeat('1',64),
        '{"givenName":"First","familyName":"Last","birthDate":"DOB"}',
        '[{"row":2,"status":"valid","errors":[],"athlete":{"givenName":"Jose\u0301","familyName":"Smith","birthDate":"2013-05-01"},"duplicateCandidateIds":[]}]');
      select preview_id from public.create_athlete_import_preview(
        '${organizationId}',repeat('2',64),
        '{"givenName":"First","familyName":"Last","birthDate":"DOB"}',
        '[{"row":2,"status":"valid","errors":[],"athlete":{"givenName":"Jos\u00e9","familyName":"Smith","birthDate":"2013-05-01"},"duplicateCandidateIds":[]}]');
    `);
      const previewIds = setup
        .split('\n')
        .filter((line) => /^[0-9a-f-]{36}$/u.test(line))
        .slice(-2);
      expect(previewIds).toHaveLength(2);
      const identityKey = `${organizationId}|josé|smith|2013-05-01`;
      let releaseFirstStarted!: () => void;
      const firstStarted = new Promise<void>((resolve) => (releaseFirstStarted = resolve));
      const session = (previewId: string, prefix = '') => `
      begin;
      set local role authenticated;
      select set_config('request.jwt.claim.role','authenticated',true);
      select set_config('request.jwt.claim.sub','${userId}',true);
      ${prefix}
      select outcome from public.commit_athlete_import('${organizationId}','${previewId}',array[2]);
      select pg_sleep(0.5);
      commit;
    `;
      const first = psqlAsync(
        session(
          previewIds[0]!,
          `select pg_advisory_xact_lock(hashtextextended('${identityKey}',0)); select 'first_ready';`,
        ),
        (output) => {
          if (output.includes('first_ready')) releaseFirstStarted();
        },
      );
      await firstStarted;
      const second = psqlAsync(session(previewIds[1]!));
      const [firstOutput, secondOutput] = await Promise.all([first, second]);
      expect(firstOutput).toContain('committed');
      expect(secondOutput).toContain('invalid_selection');
      expect(
        psql(`select count(*) from public.athletes where organization_id='${organizationId}'`),
      ).toBe('1');
    } finally {
      // The entire isolated database is dropped in afterAll. This preserves
      // every production trigger/FK and cannot leave fixtures in local Supabase.
    }
  }

  it('serializes separate preview commits hermetically on repeated runs', async () => {
    await runConcurrencyScenario();
    await runConcurrencyScenario();
  });

  it('serializes public registration ahead of an identical CSV commit on the shared identity lock', async () => {
    const userId = randomUUID();
    const organizationId = randomUUID();
    const tryoutId = randomUUID();
    const divisionId = randomUUID();
    const sessionId = randomUUID();
    const formId = randomUUID();
    const formVersionId = randomUUID();
    const slug = `csv-import-fixture-${organizationId}`;
    const tryoutSlug = `cross-path-${tryoutId.slice(0, 8)}`;
    const rateHash = randomUUID().replaceAll('-', '').padEnd(64, 'a');
    try {
      const setup = psql(`
        insert into auth.users(id) values('${userId}');
        insert into public.organizations(id,name,slug,timezone) values('${organizationId}','Cross Path Fixture','${slug}','America/Edmonton');
        insert into public.organization_members(organization_id,user_id,role,status) values('${organizationId}','${userId}','owner','active');
        insert into public.tryouts(id,organization_id,name,slug,sport,timezone,registration_starts_at,registration_ends_at) values('${tryoutId}','${organizationId}','Cross Path','${tryoutSlug}','Hockey','America/Edmonton',clock_timestamp()-interval '1 hour',clock_timestamp()+interval '1 day');
        insert into public.tryout_divisions(id,organization_id,tryout_id,name,sort_order) values('${divisionId}','${organizationId}','${tryoutId}','U13',0);
        insert into public.tryout_sessions(id,organization_id,tryout_id,division_id,name,starts_at,ends_at) values('${sessionId}','${organizationId}','${tryoutId}','${divisionId}','Skills',clock_timestamp()+interval '2 days',clock_timestamp()+interval '2 days 1 hour');
        insert into public.registration_forms(id,organization_id,tryout_id,name) values('${formId}','${organizationId}','${tryoutId}','Public');
        insert into public.registration_form_versions(id,organization_id,tryout_id,registration_form_id,version_number,schema,status,published_at) values('${formVersionId}','${organizationId}','${tryoutId}','${formId}',1,'{"fields":[{"key":"consent","label":"Consent","kind":"consent","required":true,"sortOrder":0}]}','published',clock_timestamp());
        insert into public.tryout_registration_form_selections(organization_id,tryout_id,registration_form_version_id) values('${organizationId}','${tryoutId}','${formVersionId}');
        update public.tryouts set status='published',published_at=clock_timestamp() where id='${tryoutId}';
        set role authenticated;
        select set_config('request.jwt.claim.role','authenticated',false);
        select set_config('request.jwt.claim.sub','${userId}',false);
        select preview_id from public.create_athlete_import_preview(
          '${organizationId}',repeat('8',64),
          '{"givenName":"First","familyName":"Last","birthDate":"DOB"}',
          '[{"row":2,"status":"valid","errors":[],"athlete":{"givenName":"Rae","familyName":"Cross","birthDate":"2013-05-01"},"duplicateCandidateIds":[]}]'
        );
      `);
      const previewId = setup
        .split('\n')
        .filter((line) => /^[0-9a-f-]{36}$/u.test(line))
        .at(-1);
      expect(previewId).toBeDefined();

      let releaseRegistrationReady!: () => void;
      const registrationReady = new Promise<void>(
        (resolve) => (releaseRegistrationReady = resolve),
      );
      const submission = JSON.stringify({
        givenName: 'Rae',
        familyName: 'Cross',
        birthDate: '2013-05-01',
        guardianName: 'Taylor Cross',
        guardianEmail: 'cross@example.com',
        divisionId,
        responses: { consent: true },
      }).replaceAll("'", "''");
      const registration = psqlAsync(
        `
          begin;
          set application_name='registration-import-${organizationId}';
          select public.lock_canonical_athlete_identity('${organizationId}','Rae','Cross','2013-05-01');
          select 'registration_ready';
          select outcome from public.submit_public_registration_with_phone(
            '${tryoutSlug}','${submission}'::jsonb,'cross-path-${organizationId}', '${rateHash}'
          );
          select pg_sleep(0.5);
          commit;
        `,
        (output) => {
          if (output.includes('registration_ready')) releaseRegistrationReady();
        },
      );
      await registrationReady;
      const imported = psqlAsync(`
        begin;
        set local role authenticated;
        select set_config('request.jwt.claim.role','authenticated',true);
        select set_config('request.jwt.claim.sub','${userId}',true);
        select outcome from public.commit_athlete_import('${organizationId}','${previewId}',array[2]);
        commit;
      `);
      const [registrationOutput, importOutput] = await Promise.all([registration, imported]);
      expect(registrationOutput).toContain('submitted');
      expect(importOutput).toContain('invalid_selection');
      expect(
        psql(`select count(*) from public.athletes where organization_id='${organizationId}'`),
      ).toBe('1');
      expect(
        psql(`
          select preview_rows->0->>'status'||':'||jsonb_array_length(preview_rows->0->'duplicateCandidateIds')
          from public.athlete_import_previews where id='${previewId}'
        `),
      ).toBe('duplicate_candidate:1');
    } finally {
      // Isolated database teardown is the fixture boundary for committed races.
    }
  });
});
