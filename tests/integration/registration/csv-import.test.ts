// @vitest-environment node

import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

function psql(sql: string) {
  return execFileSync(
    'psql',
    ['postgresql://postgres:postgres@127.0.0.1:54322/postgres', '-v', 'ON_ERROR_STOP=1', '-At'],
    { encoding: 'utf8', input: sql },
  ).trim();
}

function psqlAsync(sql: string, onOutput?: (output: string) => void) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(
      'psql',
      ['postgresql://postgres:postgres@127.0.0.1:54322/postgres', '-v', 'ON_ERROR_STOP=1', '-At'],
      { stdio: ['pipe', 'pipe', 'pipe'] },
    );
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
    const slug = `concurrent-${organizationId}`;
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
      psql(`
        begin;
        set local session_replication_role=replica;
        delete from public.audit_logs where organization_id='${organizationId}';
        delete from public.organizations where id='${organizationId}';
        delete from auth.users where id='${userId}';
        commit;
      `);
    }
  }

  it('serializes separate preview commits hermetically on repeated runs', async () => {
    await runConcurrencyScenario();
    await runConcurrencyScenario();
  });
});
