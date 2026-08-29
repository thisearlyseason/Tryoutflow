// @vitest-environment node

import { execFile as execFileCallback, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

const execFile = promisify(execFileCallback);
const databaseUrl =
  process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const psql = (sql: string, applicationName = 'tryoutflow-evaluation-tag-race') =>
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
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
      if (stdout.includes(expected)) resolve();
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.once('exit', (code) => {
      if (!stdout.includes(expected)) reject(new Error(`psql exited ${code}: ${stderr}`));
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

describe('evaluation note-tag serialization', () => {
  it('orders save/configuration with deactivation and offboarding without deadlocks', async () => {
    const owner = randomUUID();
    const administrator = randomUUID();
    const evaluator = randomUUID();
    const organization = randomUUID();
    const tryout = randomUUID();
    const division = randomUUID();
    const session = randomUUID();
    const form = randomUUID();
    const formVersion = randomUUID();
    const athlete = randomUUID();
    const registration = randomUUID();
    const rubric = randomUUID();
    const rubricVersion = randomUUID();
    const category = randomUUID();
    const tags = [randomUUID(), randomUUID(), randomUUID()];
    const suffix = organization.slice(0, 8);
    const names: string[] = [];
    const holders: ReturnType<typeof spawn>[] = [];
    const openGate = async (key: number, name: string) => {
      names.push(name);
      const holder = startSession(name);
      holders.push(holder);
      holder.stdin?.write(`select pg_advisory_lock(${key}); select 'gate_ready';\n`);
      await waitForOutput(holder, 'gate_ready');
      return holder;
    };
    const releaseGate = (holder: ReturnType<typeof spawn>, key: number) =>
      holder.stdin?.write(`select pg_advisory_unlock(${key});\n\\q\n`);
    const save = (tagId: string, expectedVersion: number, name: string, gate: number) =>
      psql(
        `begin; set local statement_timeout='10s'; set local role authenticated; select set_config('request.jwt.claim.sub','${evaluator}',true); create temporary table rpc_result on commit preserve rows as select outcome from public.save_evaluation_draft('${organization}','${tryout}','${division}','${registration}','${session}',null,'${rubricVersion}',${expectedVersion},'[{"categoryId":"${category}","value":4}]',null,array['${tagId}']::uuid[],array[]::text[]); select pg_advisory_lock(${gate}); commit; select outcome from rpc_result;`,
        name,
      );
    const configure = (tagId: string, label: string, active: boolean, name: string, gate: number) =>
      psql(
        `begin; set local statement_timeout='10s'; set local role authenticated; select set_config('request.jwt.claim.sub','${administrator}',true); create temporary table rpc_result on commit preserve rows as select outcome from public.configure_evaluation_note_tag('${organization}','${tagId}','${label}',${active}); select pg_advisory_lock(${gate}); commit; select outcome from rpc_result;`,
        name,
      );

    try {
      await psql(`
        insert into auth.users(id) values('${owner}'),('${administrator}'),('${evaluator}');
        insert into public.organizations(id,name,slug) values('${organization}','Tag Races','tag-races-${suffix}');
        insert into public.organization_members(organization_id,user_id,role,status) values
          ('${organization}','${owner}','owner','active'),('${organization}','${administrator}','administrator','active'),('${organization}','${evaluator}','member','active');
        insert into public.tryouts(id,organization_id,name,slug,sport,timezone) values('${tryout}','${organization}','Camp','camp-${suffix}','Hockey','America/Edmonton');
        insert into public.tryout_divisions(id,organization_id,tryout_id,name,sort_order) values('${division}','${organization}','${tryout}','Open',0);
        insert into public.tryout_sessions(id,organization_id,tryout_id,division_id,name,starts_at,ends_at,sort_order)
          values('${session}','${organization}','${tryout}','${division}','Skills',clock_timestamp()+interval '1 day',clock_timestamp()+interval '1 day 1 hour',0);
        insert into public.tryout_staff_assignments(organization_id,user_id,role,scope_kind,tryout_id,session_id,granted_by_user_id)
          values('${organization}','${evaluator}','evaluator','session','${tryout}','${session}','${owner}');
        insert into public.registration_forms(id,organization_id,tryout_id,name) values('${form}','${organization}','${tryout}','Form');
        insert into public.registration_form_versions(id,organization_id,tryout_id,registration_form_id,version_number,schema,status,published_at)
          values('${formVersion}','${organization}','${tryout}','${form}',1,'{"fields":[]}','published',clock_timestamp());
        insert into public.athletes(id,organization_id,given_name,family_name,normalized_given_name,normalized_family_name,birth_date)
          values('${athlete}','${organization}','Tag','Athlete','tag','athlete','2012-01-01');
        insert into public.tryout_registrations(id,organization_id,tryout_id,athlete_id,division_id,registration_form_version_id,responses,submission_key_digest,submission_digest)
          values('${registration}','${organization}','${tryout}','${athlete}','${division}','${formVersion}','{}',repeat('a',64),repeat('b',64));
        insert into public.session_enrollments(organization_id,tryout_id,registration_id,session_id) values('${organization}','${tryout}','${registration}','${session}');
        insert into public.rubrics(id,organization_id,tryout_id,name) values('${rubric}','${organization}','${tryout}','Skills');
        insert into public.rubric_versions(id,organization_id,tryout_id,rubric_id,version_number) values('${rubricVersion}','${organization}','${tryout}','${rubric}',1);
        insert into public.rubric_categories(id,organization_id,tryout_id,rubric_version_id,name,sort_order,weight,scale_min,scale_max)
          values('${category}','${organization}','${tryout}','${rubricVersion}','Skill',0,100,1,5);
        insert into public.session_rubrics(organization_id,tryout_id,session_id,rubric_version_id) values('${organization}','${tryout}','${session}','${rubricVersion}');
        insert into public.organization_evaluation_note_tags(id,organization_id,label) values
          ('${tags[0]}','${organization}','First'),('${tags[1]}','${organization}','Second'),('${tags[2]}','${organization}','Third');
        set session_replication_role=replica;
        update public.rubric_versions set status='published',published_at=clock_timestamp() where id='${rubricVersion}';
        update public.tryouts set status='published',published_at=clock_timestamp() where id='${tryout}';
        set session_replication_role=origin;
      `);

      // Save-first holds the selected tag KEY SHARE lock through commit, so
      // deactivation queues and cannot overtake the successful link insertion.
      const saveGateKey = 701_001;
      const saveGateName = `tag-save-gate-${suffix}`;
      const saveName = `tag-save-${suffix}`;
      const deactivateAfterSaveName = `tag-deactivate-after-save-${suffix}`;
      names.push(saveName, deactivateAfterSaveName);
      const saveGate = await openGate(saveGateKey, saveGateName);
      const saveFirst = save(tags[0]!, 0, saveName, saveGateKey);
      expect(await waitForBlockingEdge(saveName, saveGateName)).toMatch(/advisory/u);
      const deactivateAfterSave = psql(
        `begin; set local role authenticated; select set_config('request.jwt.claim.sub','${administrator}',true); create temporary table rpc_result on commit preserve rows as select outcome from public.configure_evaluation_note_tag('${organization}','${tags[0]}','First',false); commit; select outcome from rpc_result;`,
        deactivateAfterSaveName,
      );
      expect(await waitForBlockingEdge(deactivateAfterSaveName, saveName)).toMatch(
        /transactionid|tuple/u,
      );
      releaseGate(saveGate, saveGateKey);
      await expect(saveFirst).resolves.toMatchObject({ stdout: expect.stringContaining('saved') });
      await expect(deactivateAfterSave).resolves.toMatchObject({
        stdout: expect.stringContaining('saved'),
      });

      // Deactivate-first owns the tag row; the save waits, then observes inactive
      // and returns invalid_note_tag without creating a new link.
      const deactivateGateKey = 701_002;
      const deactivateGateName = `tag-deactivate-gate-${suffix}`;
      const deactivateName = `tag-deactivate-${suffix}`;
      const saveAfterDeactivateName = `tag-save-after-deactivate-${suffix}`;
      names.push(deactivateName, saveAfterDeactivateName);
      const deactivateGate = await openGate(deactivateGateKey, deactivateGateName);
      const deactivateFirst = configure(
        tags[1]!,
        'Second',
        false,
        deactivateName,
        deactivateGateKey,
      );
      expect(await waitForBlockingEdge(deactivateName, deactivateGateName)).toMatch(/advisory/u);
      const saveAfterDeactivate = save(tags[1]!, 1, saveAfterDeactivateName, 701_099);
      expect(await waitForBlockingEdge(saveAfterDeactivateName, deactivateName)).toMatch(
        /transactionid|tuple/u,
      );
      releaseGate(deactivateGate, deactivateGateKey);
      await expect(deactivateFirst).resolves.toMatchObject({
        stdout: expect.stringContaining('saved'),
      });
      await expect(saveAfterDeactivate).resolves.toMatchObject({
        stdout: expect.stringContaining('invalid_note_tag'),
      });
      expect(
        (
          await psql(
            `select count(*) from public.evaluation_note_tags where organization_id='${organization}' and note_tag_id='${tags[1]}'`,
          )
        ).stdout.trim(),
      ).toBe('0');

      // Configuration-first holds the exact active membership row, making an
      // offboard queue until the audited configuration commits.
      const configGateKey = 701_003;
      const configGateName = `tag-config-gate-${suffix}`;
      const configName = `tag-config-${suffix}`;
      const offboardName = `tag-offboard-${suffix}`;
      names.push(configName, offboardName);
      const configGate = await openGate(configGateKey, configGateName);
      const configureFirst = configure(tags[2]!, 'Third revised', true, configName, configGateKey);
      expect(await waitForBlockingEdge(configName, configGateName)).toMatch(/advisory/u);
      const offboard = psql(
        `update public.organization_members set status='disabled' where organization_id='${organization}' and user_id='${administrator}'`,
        offboardName,
      );
      expect(await waitForBlockingEdge(offboardName, configName)).toMatch(/transactionid|tuple/u);
      releaseGate(configGate, configGateKey);
      await expect(configureFirst).resolves.toMatchObject({
        stdout: expect.stringContaining('saved'),
      });
      await offboard;
      expect(
        (
          await psql(
            `select status from public.organization_members where organization_id='${organization}' and user_id='${administrator}'`,
          )
        ).stdout.trim(),
      ).toBe('disabled');
    } finally {
      await psql(
        `select pg_terminate_backend(pid) from pg_stat_activity where pid<>pg_backend_pid() and application_name=any(array[${names.map((name) => `'${name}'`).join(',')}])`,
        'tag-race-cleanup',
      ).catch(() => undefined);
      for (const holder of holders) if (holder.exitCode === null) holder.kill('SIGTERM');
      await psql(`
        set session_replication_role=replica;
        do $cleanup$ declare target record; begin
          for target in select distinct table_name from information_schema.columns
            where table_schema='public' and column_name='organization_id' and table_name<>'organizations'
          loop execute format('delete from public.%I where organization_id=$1',target.table_name) using '${organization}'::uuid; end loop;
        end $cleanup$;
        delete from public.organizations where id='${organization}';
        delete from auth.users where id in ('${owner}','${administrator}','${evaluator}');
        set session_replication_role=origin;
      `).catch(() => undefined);
    }
  });
});
