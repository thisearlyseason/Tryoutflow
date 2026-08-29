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

async function waitFor(condition: () => boolean, label: string) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`${label} timed out`);
}

async function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`${label} timed out`)), 8_000);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
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
    const gateId = randomUUID().replaceAll('-', '');
    const gateClass = Number.parseInt(gateId.slice(0, 8), 16) & 0x7fffffff;
    const gateObject = Number.parseInt(gateId.slice(8, 16), 16) & 0x7fffffff;
    const holderName = `import-holder-${organizationId}`;
    const firstName = `import-first-${organizationId}`;
    const secondName = `import-second-${organizationId}`;
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
      let releaseHolderReady!: () => void;
      const holderReady = new Promise<void>((resolve) => (releaseHolderReady = resolve));
      const holder = psqlAsync(
        `
          set application_name='${holderName}';
          select pg_advisory_lock(${gateClass},${gateObject});
          select 'holder_ready';
          select pg_sleep(30);
        `,
        (output) => {
          if (output.includes('holder_ready')) releaseHolderReady();
        },
      );
      await withTimeout(holderReady, 'two-import gate holder');
      const session = (applicationName: string, previewId: string, waitAtGate: boolean) => `
        begin;
        set local statement_timeout='7s';
        set application_name='${applicationName}';
        set local role authenticated;
        select set_config('request.jwt.claim.role','authenticated',true);
        select set_config('request.jwt.claim.sub','${userId}',true);
        select outcome from public.commit_athlete_import('${organizationId}','${previewId}',array[2]);
        ${waitAtGate ? `select pg_advisory_lock(${gateClass},${gateObject});` : ''}
        commit;
      `;
      const first = psqlAsync(session(firstName, previewIds[0]!, true));
      await waitFor(
        () =>
          psql(`
            select exists(
              select 1 from pg_stat_activity first_import
              join pg_stat_activity holder on holder.application_name='${holderName}'
              where first_import.application_name='${firstName}'
                and holder.pid=any(pg_blocking_pids(first_import.pid))
            )
          `) === 't',
        'first import post-insert gate',
      );
      const second = psqlAsync(session(secondName, previewIds[1]!, false));
      await waitFor(
        () =>
          psql(`
            select exists(
              select 1 from pg_stat_activity second_import
              join pg_stat_activity first_import on first_import.application_name='${firstName}'
              where second_import.application_name='${secondName}'
                and first_import.pid=any(pg_blocking_pids(second_import.pid))
            )
          `) === 't',
        'natural first import lock blocks the second import',
      );
      psql(
        `select pg_terminate_backend(pid) from pg_stat_activity where application_name='${holderName}'`,
      );
      await holder.catch(() => 'expected gate termination');
      const [firstOutput, secondOutput] = await withTimeout(
        Promise.all([first, second]),
        'two-import serialization',
      );
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
    const gateId = randomUUID().replaceAll('-', '');
    const gateClass = Number.parseInt(gateId.slice(0, 8), 16) & 0x7fffffff;
    const gateObject = Number.parseInt(gateId.slice(8, 16), 16) & 0x7fffffff;
    const holderName = `cross-holder-${organizationId}`;
    const registrationName = `cross-registration-${organizationId}`;
    const importName = `cross-import-${organizationId}`;
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

      const submission = JSON.stringify({
        givenName: 'Rae',
        familyName: 'Cross',
        birthDate: '2013-05-01',
        guardianName: 'Taylor Cross',
        guardianEmail: 'cross@example.com',
        divisionId,
        responses: { consent: true },
      }).replaceAll("'", "''");
      let releaseHolderReady!: () => void;
      const holderReady = new Promise<void>((resolve) => (releaseHolderReady = resolve));
      const holder = psqlAsync(
        `
          set application_name='${holderName}';
          select pg_advisory_lock(${gateClass},${gateObject});
          select 'holder_ready';
          select pg_sleep(30);
        `,
        (output) => {
          if (output.includes('holder_ready')) releaseHolderReady();
        },
      );
      await withTimeout(holderReady, 'cross-path gate holder');

      const registration = psqlAsync(
        `
          begin;
          set local statement_timeout='7s';
          set application_name='${registrationName}';
          select outcome from public.submit_public_registration_with_phone(
            '${tryoutSlug}','${submission}'::jsonb,'cross-path-${organizationId}', '${rateHash}'
          );
          select 'registration_inserted';
          select pg_advisory_lock(${gateClass},${gateObject});
          commit;
        `,
      );
      await waitFor(
        () =>
          psql(`
            select exists(
              select 1 from pg_stat_activity registration
              join pg_stat_activity holder on holder.application_name='${holderName}'
              where registration.application_name='${registrationName}'
                and holder.pid=any(pg_blocking_pids(registration.pid))
            )
          `) === 't',
        'registration post-insert gate',
      );
      const imported = psqlAsync(`
        begin;
        set local statement_timeout='7s';
        set application_name='${importName}';
        set local role authenticated;
        select set_config('request.jwt.claim.role','authenticated',true);
        select set_config('request.jwt.claim.sub','${userId}',true);
        select outcome from public.commit_athlete_import('${organizationId}','${previewId}',array[2]);
        commit;
      `);
      await waitFor(
        () =>
          psql(`
            select exists(
              select 1 from pg_stat_activity imported
              join pg_stat_activity registration on registration.application_name='${registrationName}'
              where imported.application_name='${importName}'
                and registration.pid=any(pg_blocking_pids(imported.pid))
            )
          `) === 't',
        'natural registration trigger blocks import',
      );
      psql(
        `select pg_terminate_backend(pid) from pg_stat_activity where application_name='${holderName}'`,
      );
      await holder.catch(() => 'expected gate termination');
      const [registrationOutput, importOutput] = await withTimeout(
        Promise.all([registration, imported]),
        'natural registration/import serialization',
      );
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

  it('orders inverse multi-identity batches by the signed advisory key without deadlock', async () => {
    const userId = randomUUID();
    const organizationId = randomUUID();
    const slug = `csv-import-fixture-${organizationId}`;
    const gateId = randomUUID().replaceAll('-', '');
    const gateClass = Number.parseInt(gateId.slice(0, 8), 16) & 0x7fffffff;
    const gateObject = Number.parseInt(gateId.slice(8, 16), 16) & 0x7fffffff;
    const holderName = `batch-holder-${organizationId}`;
    const firstName = `batch-first-${organizationId}`;
    const secondName = `batch-second-${organizationId}`;
    const identityA = {
      givenName: 'Ada|Beth',
      familyName: 'Chen',
      birthDate: '2012-01-01',
    };
    const identityB = {
      givenName: 'Ada',
      familyName: 'Beth|Chen',
      birthDate: '2012-01-01',
    };
    const row = (rowNumber: number, athlete: typeof identityA) => ({
      row: rowNumber,
      status: 'valid',
      errors: [],
      athlete,
      duplicateCandidateIds: [],
    });
    const setup = psql(`
      insert into auth.users(id) values('${userId}');
      insert into public.organizations(id,name,slug,timezone)
      values('${organizationId}','Inverse Batch Fixture','${slug}','America/Edmonton');
      insert into public.organization_members(organization_id,user_id,role,status)
      values('${organizationId}','${userId}','owner','active');
      set role authenticated;
      select set_config('request.jwt.claim.role','authenticated',false);
      select set_config('request.jwt.claim.sub','${userId}',false);
      select preview_id from public.create_athlete_import_preview(
        '${organizationId}',repeat('a',64),
        '{"givenName":"First","familyName":"Last","birthDate":"DOB"}',
        '${JSON.stringify([row(2, identityA), row(3, identityB)])}'::jsonb
      );
      select preview_id from public.create_athlete_import_preview(
        '${organizationId}',repeat('b',64),
        '{"givenName":"First","familyName":"Last","birthDate":"DOB"}',
        '${JSON.stringify([row(2, identityB), row(3, identityA)])}'::jsonb
      );
    `);
    const previewIds = setup
      .split('\n')
      .filter((line) => /^[0-9a-f-]{36}$/u.test(line))
      .slice(-2);
    expect(previewIds).toHaveLength(2);

    let releaseHolderReady!: () => void;
    const holderReady = new Promise<void>((resolve) => (releaseHolderReady = resolve));
    const holder = psqlAsync(
      `
        set application_name='${holderName}';
        select pg_advisory_lock(${gateClass},${gateObject});
        select 'holder_ready';
        select pg_sleep(30);
      `,
      (output) => {
        if (output.includes('holder_ready')) releaseHolderReady();
      },
    );
    await withTimeout(holderReady, 'inverse-batch gate holder');

    const commit = (applicationName: string, previewId: string, waitAtGate: boolean) =>
      psqlAsync(`
        begin;
        set local statement_timeout='7s';
        set application_name='${applicationName}';
        set local role authenticated;
        select set_config('request.jwt.claim.role','authenticated',true);
        select set_config('request.jwt.claim.sub','${userId}',true);
        select outcome from public.commit_athlete_import('${organizationId}','${previewId}',array[2,3]);
        ${waitAtGate ? `select 'first_import_holds_identity_locks'; select pg_advisory_lock(${gateClass},${gateObject});` : ''}
        commit;
      `);
    const first = commit(firstName, previewIds[0]!, true);
    await waitFor(
      () =>
        psql(`
          select exists(
            select 1
            from pg_stat_activity first_batch
            join pg_stat_activity holder on holder.application_name='${holderName}'
            where first_batch.application_name='${firstName}'
              and holder.pid=any(pg_blocking_pids(first_batch.pid))
              and (
                select count(distinct ((identity_lock.classid::bigint<<32)|identity_lock.objid::bigint))
                from pg_locks identity_lock
                where identity_lock.pid=first_batch.pid
                  and identity_lock.locktype='advisory'
                  and identity_lock.objsubid=1
                  and identity_lock.granted
                  and ((identity_lock.classid::bigint<<32)|identity_lock.objid::bigint) in(
                    public.canonical_athlete_identity_lock_key(
                      '${organizationId}','Ada|Beth','Chen','2012-01-01'
                    ),
                    public.canonical_athlete_identity_lock_key(
                      '${organizationId}','Ada','Beth|Chen','2012-01-01'
                    )
                  )
              )=2
          )
        `) === 't',
      'first inverse batch naturally holds both identity locks at the test handshake',
    );
    const second = commit(secondName, previewIds[1]!, false);
    await waitFor(
      () =>
        psql(`
          select exists(
            select 1
            from pg_stat_activity second_batch
            join pg_stat_activity first_batch on first_batch.application_name='${firstName}'
            join pg_locks waiting_identity_lock
              on waiting_identity_lock.pid=second_batch.pid
              and waiting_identity_lock.locktype='advisory'
              and waiting_identity_lock.objsubid=1
              and not waiting_identity_lock.granted
            join pg_locks held_identity_lock
              on held_identity_lock.pid=first_batch.pid
              and held_identity_lock.locktype='advisory'
              and held_identity_lock.objsubid=waiting_identity_lock.objsubid
              and held_identity_lock.classid=waiting_identity_lock.classid
              and held_identity_lock.objid=waiting_identity_lock.objid
              and held_identity_lock.granted
            where second_batch.application_name='${secondName}'
              and first_batch.pid=any(pg_blocking_pids(second_batch.pid))
              and ((waiting_identity_lock.classid::bigint<<32)|waiting_identity_lock.objid::bigint)=least(
                public.canonical_athlete_identity_lock_key(
                  '${organizationId}','Ada|Beth','Chen','2012-01-01'
                ),
                public.canonical_athlete_identity_lock_key(
                  '${organizationId}','Ada','Beth|Chen','2012-01-01'
                )
              )
          )
        `) === 't',
      'second inverse batch naturally waits on the first signed identity key',
    );
    psql(
      `select pg_terminate_backend(pid) from pg_stat_activity where application_name='${holderName}'`,
    );
    await holder.catch(() => 'expected gate termination');
    const outputs = await withTimeout(
      Promise.all([first, second]),
      'inverse multi-identity commit race',
    );
    expect(
      outputs
        .map((output) =>
          output.split('\n').find((line) => ['committed', 'invalid_selection'].includes(line)),
        )
        .sort(),
    ).toEqual(['committed', 'invalid_selection']);
    expect(
      psql(`select count(*) from public.athletes where organization_id='${organizationId}'`),
    ).toBe('2');
    expect(
      psql(`
        select public.canonical_athlete_identity_lock_key('${organizationId}','Ada|Beth','Chen','2012-01-01')
          <> public.canonical_athlete_identity_lock_key('${organizationId}','Ada','Beth|Chen','2012-01-01')
      `),
    ).toBe('t');
  }, 15_000);
});
