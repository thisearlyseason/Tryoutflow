// @vitest-environment node

import { execFile as execFileCallback, spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

const execFile = promisify(execFileCallback);
const databaseUrl =
  process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const psql = (sql: string) =>
  execFile('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-At', databaseUrl, '-c', sql]);
const waitFor = async (condition: () => Promise<boolean>) => {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  throw new Error('registration concurrency lock handshake timed out');
};
const waitForExit = async (process: ChildProcess | undefined) => {
  if (!process || process.exitCode !== null) return;
  await new Promise<void>((resolve) => process.once('exit', () => resolve()));
};

describe('registration idempotency concurrency', () => {
  it('serializes identical retries and leaves the replay token as the sole usable token', async () => {
    const organizationId = randomUUID();
    const tryoutId = randomUUID();
    const divisionId = randomUUID();
    const sessionId = randomUUID();
    const formId = randomUUID();
    const formVersionId = randomUUID();
    const caseId = randomUUID();
    const classId = Number.parseInt(caseId.replaceAll('-', '').slice(0, 8), 16) & 0x7fffffff;
    const objectId = Number.parseInt(caseId.replaceAll('-', '').slice(8, 16), 16) & 0x7fffffff;
    const holderName = `registration-holder-${caseId}`;
    const firstName = `registration-first-${caseId}`;
    const secondName = `registration-second-${caseId}`;
    const slug = `registration-${tryoutId.slice(0, 8)}`;
    const idempotencyKey = `concurrent-registration-${caseId}`;
    const resultTable = `registration_concurrency_${caseId.replaceAll('-', '')}`;
    const submission = JSON.stringify({
      givenName: 'Ava',
      familyName: 'Smith',
      birthDate: '2013-05-01',
      guardianName: 'Taylor Smith',
      guardianEmail: 'guardian@example.com',
      guardianPhone: '+1 (403) 555-0100',
      divisionId,
      responses: { consent: true },
    });
    let holder: ChildProcess | undefined;
    try {
      await psql(`
        insert into public.organizations(id,name,slug,timezone) values('${organizationId}','Concurrent Registration Club','registration-${organizationId.slice(0, 8)}','America/Edmonton');
        insert into public.tryouts(id,organization_id,name,slug,sport,timezone,registration_starts_at,registration_ends_at) values('${tryoutId}','${organizationId}','Concurrent Camp','${slug}','Hockey','America/Edmonton',clock_timestamp()-interval '1 hour',clock_timestamp()+interval '1 day');
        insert into public.tryout_divisions(id,organization_id,tryout_id,name,sort_order) values('${divisionId}','${organizationId}','${tryoutId}','U13',0);
        insert into public.tryout_sessions(id,organization_id,tryout_id,division_id,name,starts_at,ends_at) values('${sessionId}','${organizationId}','${tryoutId}','${divisionId}','Skills',clock_timestamp()+interval '2 days',clock_timestamp()+interval '2 days 1 hour');
        insert into public.registration_forms(id,organization_id,tryout_id,name) values('${formId}','${organizationId}','${tryoutId}','Public');
        insert into public.registration_form_versions(id,organization_id,tryout_id,registration_form_id,version_number,schema,status,published_at) values('${formVersionId}','${organizationId}','${tryoutId}','${formId}',1,'{"fields":[{"key":"consent","label":"Consent","kind":"consent","required":true,"sortOrder":0}]}','published',clock_timestamp());
        insert into public.tryout_registration_form_selections(organization_id,tryout_id,registration_form_version_id) values('${organizationId}','${tryoutId}','${formVersionId}');
        update public.tryouts set status='published',published_at=clock_timestamp() where id='${tryoutId}';
        create table public.${resultTable}(request_name text primary key,outcome text not null,confirmation_token text);
      `);
      holder = spawn(
        'psql',
        [
          '-X',
          '-v',
          'ON_ERROR_STOP=1',
          '-At',
          databaseUrl,
          '-c',
          `set application_name='${holderName}'; select pg_advisory_lock(${classId},${objectId}); select pg_sleep(30);`,
        ],
        { stdio: 'ignore' },
      );
      await waitFor(
        async () =>
          (
            await psql(
              `select exists(select 1 from pg_stat_activity where application_name='${holderName}')`,
            )
          ).stdout.trim() === 't',
      );
      const call = (name: string, rateDigit: string, waitAfter: boolean) =>
        psql(
          `set application_name='${name}'; begin; insert into public.${resultTable} select '${name}',outcome,confirmation_token from public.submit_public_registration_with_phone('${slug}','${submission}'::jsonb,'${idempotencyKey}',repeat('${rateDigit}',64)); ${waitAfter ? `select pg_advisory_lock(${classId},${objectId});` : ''} commit;`,
        );
      const first = call(firstName, '6', true);
      await waitFor(
        async () =>
          (
            await psql(
              `select exists(select 1 from pg_stat_activity where application_name='${firstName}' and wait_event_type='Lock')`,
            )
          ).stdout.trim() === 't',
      );
      const second = call(secondName, '7', false);
      await waitFor(
        async () =>
          (
            await psql(
              `select exists(select 1 from pg_stat_activity second join pg_stat_activity first on first.application_name='${firstName}' where second.application_name='${secondName}' and first.pid=any(pg_blocking_pids(second.pid)))`,
            )
          ).stdout.trim() === 't',
      );
      await psql(
        `select pg_terminate_backend(pid) from pg_stat_activity where application_name='${holderName}'`,
      );
      await Promise.all([first, second]);
      await waitForExit(holder);
      holder = undefined;

      const { stdout: rows } = await psql(
        `select request_name||'|'||outcome||'|'||coalesce(confirmation_token,'NULL') from public.${resultTable} order by request_name`,
      );
      const resultRows = new Map(
        rows
          .trim()
          .split('\n')
          .map((line) => {
            const [name, outcome, token] = line.split('|');
            return [name, { outcome, token }] as const;
          }),
      );
      expect(resultRows.get(firstName)?.outcome).toBe('submitted');
      expect(resultRows.get(secondName)?.outcome).toBe('replayed');
      const originalToken = resultRows.get(firstName)?.token ?? '';
      const replayToken = resultRows.get(secondName)?.token ?? '';
      expect(originalToken).toMatch(/^[0-9a-f]{64}$/u);
      expect(replayToken).toMatch(/^[0-9a-f]{64}$/u);
      expect(
        (
          await psql(
            `select count(*) from public.tryout_registrations where tryout_id='${tryoutId}'`,
          )
        ).stdout.trim(),
      ).toBe('1');
      expect(
        (
          await psql(
            `select count(*) from public.registration_confirmation_tokens where used_at is null and revoked_at is null and registration_id in(select id from public.tryout_registrations where tryout_id='${tryoutId}')`,
          )
        ).stdout.trim(),
      ).toBe('1');
      expect(
        (
          await psql(
            `select token_digest=encode(extensions.digest('${replayToken}','sha256'),'hex') from public.registration_confirmation_tokens where used_at is null and revoked_at is null and registration_id in(select id from public.tryout_registrations where tryout_id='${tryoutId}')`,
          )
        ).stdout.trim(),
      ).toBe('t');
      expect(
        (
          await psql(
            `select outcome from public.consume_registration_confirmation_token('${originalToken}')`,
          )
        ).stdout.trim(),
      ).toBe('invalid');
      expect(
        (
          await psql(
            `select outcome from public.consume_registration_confirmation_token('${replayToken}')`,
          )
        ).stdout.trim(),
      ).toBe('confirmed');
    } finally {
      if (holder && holder.exitCode === null) holder.kill();
      await waitForExit(holder);
      await psql(`
        set session_replication_role=replica;
        drop table if exists public.${resultTable};
        delete from public.registration_confirmation_tokens where organization_id='${organizationId}';
        delete from public.registration_duplicate_candidates where organization_id='${organizationId}';
        delete from public.session_enrollments where organization_id='${organizationId}';
        delete from public.tryout_registrations where organization_id='${organizationId}';
        delete from public.athlete_guardians where organization_id='${organizationId}';
        delete from public.guardians where organization_id='${organizationId}';
        delete from public.athletes where organization_id='${organizationId}';
        delete from public.tryout_registration_form_selections where organization_id='${organizationId}';
        delete from public.registration_form_versions where organization_id='${organizationId}';
        delete from public.registration_forms where organization_id='${organizationId}';
        delete from public.tryout_sessions where organization_id='${organizationId}';
        delete from public.tryout_divisions where organization_id='${organizationId}';
        delete from public.tryouts where organization_id='${organizationId}';
        delete from public.organizations where id='${organizationId}';
        delete from public.registration_rate_counters where key_hash in(repeat('6',64),repeat('7',64));
        set session_replication_role=origin;
      `);
    }
  });
});
