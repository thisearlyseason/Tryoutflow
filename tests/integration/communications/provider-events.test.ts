// @vitest-environment node

import { execFile as execFileCallback } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';

import { afterAll, describe, expect, it } from 'vitest';

const execFile = promisify(execFileCallback);
const databaseUrl =
  process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const psql = (sql: string) =>
  execFile('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-At', databaseUrl, '-c', sql]);
const waitForBlockingEdge = async (blockedName: string, blockerName: string) => {
  for (let attempt = 0; attempt < 250; attempt += 1) {
    const result = await psql(`
      select exists(
        select 1 from pg_stat_activity blocked
        join pg_stat_activity blocker on blocker.application_name='${blockerName}'
        where blocked.application_name='${blockedName}'
          and blocked.wait_event_type='Lock'
          and blocker.pid=any(pg_blocking_pids(blocked.pid))
      )
    `);
    if (result.stdout.trim() === 't') return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`${blockedName} was not blocked by ${blockerName}`);
};
const waitForSleepingSession = async (applicationName: string) => {
  for (let attempt = 0; attempt < 250; attempt += 1) {
    const result = await psql(`select exists(select 1 from pg_stat_activity
      where application_name='${applicationName}' and wait_event='PgSleep')`);
    if (result.stdout.trim() === 't') return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`${applicationName} did not acquire its row lock`);
};
const ids = {
  owner: randomUUID(),
  director: randomUUID(),
  organization: randomUUID(),
  tryout: randomUUID(),
  division: randomUUID(),
  form: randomUUID(),
  formVersion: randomUUID(),
  athlete: randomUUID(),
  guardian: randomUUID(),
  registration: randomUUID(),
  roster: randomUUID(),
};
const slug = `messages-${ids.organization.slice(0, 8)}`;
let messageId = '';

afterAll(async () => {
  await psql(`
    set session_replication_role=replica;
    alter table public.communication_pending_delivery_events disable trigger prevent_pending_delivery_events_mutation;
    delete from public.communication_pending_delivery_events where message_id in(
      select id from public.communication_messages where organization_id='${ids.organization}');
    alter table public.communication_pending_delivery_events enable always trigger prevent_pending_delivery_events_mutation;
    alter table public.communication_delivery_events disable trigger prevent_communication_delivery_events_mutation;
    delete from public.communication_delivery_events where organization_id='${ids.organization}';
    alter table public.communication_delivery_events enable always trigger prevent_communication_delivery_events_mutation;
    delete from public.communication_preview_proofs where organization_id='${ids.organization}';
    alter table public.communication_preview_tombstones disable trigger prevent_communication_preview_tombstones_mutation;
    delete from public.communication_preview_tombstones where communication_batch_id in(
      select id from public.communication_batches where organization_id='${ids.organization}');
    alter table public.communication_preview_tombstones enable always trigger prevent_communication_preview_tombstones_mutation;
    delete from public.outbox_provider_handoffs where organization_id='${ids.organization}';
    delete from public.outbox_jobs where organization_id='${ids.organization}';
    delete from public.communication_messages where organization_id='${ids.organization}';
    alter table public.communication_batches disable trigger prevent_communication_batches_mutation;
    delete from public.communication_batches where organization_id='${ids.organization}';
    alter table public.communication_batches enable always trigger prevent_communication_batches_mutation;
    delete from public.communication_templates where organization_id='${ids.organization}';
    alter table public.roster_decisions disable trigger guard_roster_decisions_snapshot;
    delete from public.roster_decisions where organization_id='${ids.organization}';
    alter table public.roster_decisions enable always trigger guard_roster_decisions_snapshot;
    alter table public.roster_versions disable trigger prevent_finalized_roster_version_mutation;
    delete from public.roster_versions where organization_id='${ids.organization}';
    alter table public.roster_versions enable always trigger prevent_finalized_roster_version_mutation;
    delete from public.athlete_guardians where organization_id='${ids.organization}';
    delete from public.guardians where organization_id='${ids.organization}';
    delete from public.tryout_registrations where organization_id='${ids.organization}';
    delete from public.athletes where organization_id='${ids.organization}';
    delete from public.registration_form_versions where organization_id='${ids.organization}';
    delete from public.registration_forms where organization_id='${ids.organization}';
    delete from public.tryout_staff_assignments where organization_id='${ids.organization}';
    delete from public.tryout_divisions where organization_id='${ids.organization}';
    delete from public.tryouts where organization_id='${ids.organization}';
    delete from public.organization_members where organization_id='${ids.organization}';
    delete from public.audit_logs where organization_id='${ids.organization}';
    delete from public.organizations where id='${ids.organization}';
    delete from auth.users where id in('${ids.owner}','${ids.director}');
    set session_replication_role=origin;
  `);
});

describe('decision batches and provider evidence', () => {
  it('creates the exact confirmed batch atomically and replays without changing the decision', async () => {
    await psql(`
      insert into auth.users(id,email) values('${ids.owner}','owner-${ids.owner}@example.com'),
        ('${ids.director}','director-${ids.director}@example.com');
      insert into public.organizations(id,name,slug) values('${ids.organization}','Badlands Hockey Academy','${slug}');
      insert into public.organization_members(organization_id,user_id,role,status) values('${ids.organization}','${ids.owner}','owner','active');
      insert into public.organization_members(organization_id,user_id,role,status) values('${ids.organization}','${ids.director}','member','active');
      insert into public.tryouts(id,organization_id,name,slug,sport,timezone) values('${ids.tryout}','${ids.organization}','U15 Competitive Tryout','${slug}-tryout','Hockey','America/Edmonton');
      insert into public.tryout_divisions(id,organization_id,tryout_id,name,sort_order) values('${ids.division}','${ids.organization}','${ids.tryout}','U15',0);
      insert into public.tryout_staff_assignments(organization_id,user_id,role,scope_kind,tryout_id,granted_by_user_id)
        values('${ids.organization}','${ids.director}','director','tryout','${ids.tryout}','${ids.owner}');
      insert into public.registration_forms(id,organization_id,tryout_id,name) values('${ids.form}','${ids.organization}','${ids.tryout}','Form');
      insert into public.registration_form_versions(id,organization_id,tryout_id,registration_form_id,version_number,schema,status,published_at) values('${ids.formVersion}','${ids.organization}','${ids.tryout}','${ids.form}',1,'{"fields":[]}','published',clock_timestamp());
      insert into public.athletes(id,organization_id,given_name,family_name,normalized_given_name,normalized_family_name,birth_date) values('${ids.athlete}','${ids.organization}','Ava','Smith','ava','smith','2013-01-01');
      insert into public.guardians(id,organization_id,name,email,normalized_email) values('${ids.guardian}','${ids.organization}','Private Guardian','decision-recipient@example.com','decision-recipient@example.com');
      insert into public.athlete_guardians(organization_id,athlete_id,guardian_id,relationship_label,is_primary_contact,communication_permitted) values('${ids.organization}','${ids.athlete}','${ids.guardian}','Guardian',true,true);
      insert into public.tryout_registrations(id,organization_id,tryout_id,athlete_id,division_id,registration_form_version_id,responses,submission_key_digest,submission_digest) values('${ids.registration}','${ids.organization}','${ids.tryout}','${ids.athlete}','${ids.division}','${ids.formVersion}','{}',repeat('a',64),repeat('b',64));
      insert into public.roster_versions(id,organization_id,tryout_id,division_id,revision_number,state,version,created_by_user_id) values('${ids.roster}','${ids.organization}','${ids.tryout}','${ids.division}',1,'draft',6,'${ids.owner}');
      insert into public.roster_decisions(organization_id,tryout_id,division_id,roster_version_id,registration_id,status,changed_by_user_id,changed_at) values('${ids.organization}','${ids.tryout}','${ids.division}','${ids.roster}','${ids.registration}','selected','${ids.owner}',clock_timestamp());
      set role authenticated; select set_config('request.jwt.claim.role','authenticated',false); select set_config('request.jwt.claim.sub','${ids.owner}',false);
      select public.finalize_roster_version('${ids.organization}','${ids.tryout}','${ids.division}','${ids.roster}',6,'FINALIZE ROSTER');
    `);
    const preview = await psql(`
      set role authenticated; select set_config('request.jwt.claim.role','authenticated',false); select set_config('request.jwt.claim.sub','${ids.owner}',false);
      select public.preview_decision_message_batch_v2('${ids.organization}','${ids.roster}','selected',
        'Welcome to the program.','builtin:selected',1);
    `);
    const data = JSON.parse(preview.stdout.trim()) as {
      digest: string;
      previewToken: string;
      rosterVersion: number;
      recipients: { registrationId: string; subject: string; text: string; html: string }[];
    };
    expect(data).toMatchObject({
      rosterVersion: 7,
      recipients: [{ registrationId: ids.registration }],
    });
    const wrongActor = await psql(`
      set role authenticated; select set_config('request.jwt.claim.role','authenticated',false);
      select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000999',false);
      select outcome from public.create_decision_message_batch_v2(
        '${ids.organization}','${ids.tryout}','${ids.division}','${ids.roster}','${data.previewToken}','${data.digest}','SEND EXACT BATCH');
    `);
    expect(wrongActor.stdout.trim()).toBe('forbidden');
    await psql(
      `update public.organizations set name='Changed after preview' where id='${ids.organization}'`,
    );
    const protectedFactConflict = await psql(`
      set role authenticated; select set_config('request.jwt.claim.role','authenticated',false); select set_config('request.jwt.claim.sub','${ids.owner}',false);
      select outcome from public.create_decision_message_batch_v2(
        '${ids.organization}','${ids.tryout}','${ids.division}','${ids.roster}','${data.previewToken}','${data.digest}','SEND EXACT BATCH');
    `);
    expect(protectedFactConflict.stdout.trim()).toBe('preview_conflict');
    await psql(
      `update public.organizations set name='Badlands Hockey Academy' where id='${ids.organization}'`,
    );
    await psql(`update public.communication_preview_proofs set issued_at=clock_timestamp()-interval '20 minutes',
      expires_at=clock_timestamp()-interval '10 minutes' where render_digest='${data.digest}'`);
    expect(
      (
        await psql(`set role authenticated; select set_config('request.jwt.claim.role','authenticated',false);
      select set_config('request.jwt.claim.sub','${ids.owner}',false); select outcome from public.create_decision_message_batch_v2(
      '${ids.organization}','${ids.tryout}','${ids.division}','${ids.roster}','${data.previewToken}','${data.digest}','SEND EXACT BATCH')`)
      ).stdout.trim(),
    ).toBe('preview_conflict');
    await psql(`update public.communication_preview_proofs set issued_at=clock_timestamp(),
      expires_at=clock_timestamp()+interval '10 minutes' where render_digest='${data.digest}'`);
    const createSql = `
      begin;
      set role authenticated; select set_config('request.jwt.claim.role','authenticated',false); select set_config('request.jwt.claim.sub','${ids.owner}',false);
      select outcome||'|'||batch_id||'|'||queued_count from public.create_decision_message_batch_v2(
        '${ids.organization}','${ids.tryout}','${ids.division}','${ids.roster}','${data.previewToken}','${data.digest}','SEND EXACT BATCH');
      reset role;
      update public.outbox_jobs set available_at='9999-01-01' where organization_id='${ids.organization}' and status='pending';
      commit;`;
    const created = await psql(createSql);
    expect(created.stdout.trim()).toBe('COMMIT');
    const createdResult = (
      await psql(`select id||'|'||recipient_count from public.communication_batches
        where organization_id='${ids.organization}' and preview_digest='${data.digest}'`)
    ).stdout.trim();
    expect(createdResult).toMatch(/^[0-9a-f-]{36}\|1$/u);
    await psql(createSql);
    const replayedResult = (
      await psql(`select id||'|'||recipient_count||'|'||
        (select count(*) from public.communication_messages where communication_batch_id=batch.id)
        from public.communication_batches batch where organization_id='${ids.organization}' and preview_digest='${data.digest}'`)
    ).stdout.trim();
    expect(replayedResult).toBe(`${createdResult}|1`);
    expect(
      (
        await psql(`select (select count(*) from public.communication_preview_proofs where token_digest=
          encode(extensions.digest(convert_to('${data.previewToken}','UTF8'),'sha256'),'hex'))||'|'||
          (select count(*) from public.communication_preview_tombstones where token_digest=
          encode(extensions.digest(convert_to('${data.previewToken}','UTF8'),'sha256'),'hex'))`)
      ).stdout.trim(),
    ).toBe('0|1');
    const evidence = await psql(`select id||'|'||state||'|'||
      (protected_facts_snapshot ? 'decision')||'|'||
      (content_snapshot::text !~* 'guardian|score|evaluator|private guardian')||'|'||
      (select status from public.roster_decisions where roster_version_id='${ids.roster}' and registration_id='${ids.registration}')
      from public.communication_messages where communication_batch_id is not null and organization_id='${ids.organization}'`);
    const [id, state, protectedFacts, privateSafe, decision] = evidence.stdout.trim().split('|');
    messageId = id!;
    expect([state, protectedFacts, privateSafe, decision]).toEqual([
      'queued',
      'true',
      'true',
      'selected',
    ]);
    const exactContent = JSON.parse(
      (
        await psql(`select content_snapshot from public.communication_messages
      where id='${messageId}'`)
      ).stdout.trim(),
    );
    expect(exactContent).toEqual({
      subject: data.recipients[0]!.subject,
      text: data.recipients[0]!.text,
      html: data.recipients[0]!.html,
    });
    const savedTemplate = JSON.parse(
      (
        await psql(`set role authenticated; select set_config('request.jwt.claim.role','authenticated',false);
      select set_config('request.jwt.claim.sub','${ids.owner}',false); select public.save_communication_template(
      '${ids.organization}','selected','Saved organization copy',0)`)
      ).stdout.trim(),
    ) as { outcome: string; version: number; templateId: string };
    expect(savedTemplate).toMatchObject({ outcome: 'saved', version: 1 });
    expect(
      JSON.parse(
        (
          await psql(`set role authenticated; select set_config('request.jwt.claim.role','authenticated',false);
      select set_config('request.jwt.claim.sub','${ids.owner}',false); select public.save_communication_template(
      '${ids.organization}','selected','Stale copy',0)`)
        ).stdout.trim(),
      ),
    ).toMatchObject({ outcome: 'version_conflict', version: 1 });
    const directorAccess = JSON.parse(
      (
        await psql(`set role authenticated; select set_config('request.jwt.claim.role','authenticated',false);
      select set_config('request.jwt.claim.sub','${ids.director}',false);
      select jsonb_build_object('templates',(select jsonb_agg(row_to_json(template)) from
        public.list_communication_templates_for_notice('${ids.organization}','${ids.tryout}') template),
        'save',public.save_communication_template('${ids.organization}','selected','Director cannot save',1))`)
      ).stdout.trim(),
    ) as { templates: unknown[]; save: { outcome: string } };
    expect(directorAccess.templates).toHaveLength(1);
    expect(directorAccess.save).toEqual({ outcome: 'forbidden' });

    const customPreview = JSON.parse(
      (
        await psql(`set role authenticated; select set_config('request.jwt.claim.role','authenticated',false);
      select set_config('request.jwt.claim.sub','${ids.owner}',false);
      select public.preview_decision_message_batch_v2('${ids.organization}','${ids.roster}','selected',
        'Per-batch custom copy','${savedTemplate.templateId}',1)`)
      ).stdout.trim(),
    ) as { digest: string; previewToken: string };
    await psql(`set role authenticated; select set_config('request.jwt.claim.role','authenticated',false);
      select set_config('request.jwt.claim.sub','${ids.owner}',false); select public.save_communication_template(
      '${ids.organization}','selected','Updated organization copy',1)`);
    expect(
      (
        await psql(`set role authenticated; select set_config('request.jwt.claim.role','authenticated',false);
      select set_config('request.jwt.claim.sub','${ids.owner}',false); select outcome from public.create_decision_message_batch_v2(
      '${ids.organization}','${ids.tryout}','${ids.division}','${ids.roster}','${customPreview.previewToken}',
      '${customPreview.digest}','SEND EXACT BATCH')`)
      ).stdout.trim(),
    ).toBe('preview_conflict');

    const rateOutcomes: string[] = [];
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const output =
        await psql(`set role authenticated; select set_config('request.jwt.claim.role','authenticated',false);
        select set_config('request.jwt.claim.sub','${ids.owner}',false);
        select public.preview_decision_message_batch_v2('${ids.organization}','${ids.roster}','selected',
          'Rate bounded ${attempt}','builtin:selected',1)->>'outcome'`);
      rateOutcomes.push(output.stdout.trim());
    }
    expect(rateOutcomes).toEqual([...Array(9).fill('ok'), 'rate_limited']);
    await psql(`update public.communication_preview_proofs set issued_at=clock_timestamp()-interval '20 minutes',
      expires_at=clock_timestamp()-interval '10 minutes' where organization_id='${ids.organization}'`);
    expect(
      (
        await psql(`set role service_role; select public.purge_expired_communication_previews(3)`)
      ).stdout.trim(),
    ).toBe('3');
    expect(
      (
        await psql(`select count(*) from public.communication_preview_proofs
          where organization_id='${ids.organization}'`)
      ).stdout.trim(),
    ).toBe('7');
    expect(
      (
        await psql(`set role service_role; select public.purge_expired_communication_previews(100)`)
      ).stdout.trim(),
    ).toBe('7');
    expect(
      (
        await psql(`select count(*) from public.communication_preview_proofs
          where organization_id='${ids.organization}'`)
      ).stdout.trim(),
    ).toBe('0');
    await psql(`update public.athlete_guardians set is_primary_contact=false
      where organization_id='${ids.organization}' and athlete_id='${ids.athlete}' and guardian_id='${ids.guardian}'`);
    expect(
      (await psql(`select private.lock_communication_source_reason('${messageId}')`)).stdout.trim(),
    ).toBe('recipient_suppressed');
    await psql(`update public.athlete_guardians set is_primary_contact=true
      where organization_id='${ids.organization}' and athlete_id='${ids.athlete}' and guardian_id='${ids.guardian}'`);
  });

  it('serializes simultaneous exact preview confirmations into one queue and one truthful replay', async () => {
    const preview = JSON.parse(
      (
        await psql(`set role authenticated; select set_config('request.jwt.claim.role','authenticated',false);
          select set_config('request.jwt.claim.sub','${ids.owner}',false);
          select public.preview_decision_message_batch_v2('${ids.organization}','${ids.roster}','selected',
            'Concurrency-bound exact confirmation.','builtin:selected',1)`)
      ).stdout.trim(),
    ) as { digest: string; previewToken: string };
    const suffix = randomUUID().slice(0, 8);
    const holderName = `message-roster-holder-${suffix}`;
    const firstName = `message-confirm-first-${suffix}`;
    const secondName = `message-confirm-second-${suffix}`;
    const holder = psql(`
      set application_name='${holderName}';
      begin;
      select id from public.roster_versions where id='${ids.roster}' for update;
      select pg_sleep(30);
      commit;
    `).then(
      () => undefined,
      () => undefined,
    );

    try {
      await waitForSleepingSession(holderName);
      const confirmSql = (applicationName: string) => `
        set application_name='${applicationName}';
        set role authenticated;
        select set_config('request.jwt.claim.role','authenticated',false);
        select set_config('request.jwt.claim.sub','${ids.owner}',false);
        select outcome||'|'||coalesce(batch_id::text,'')||'|'||queued_count
        from public.create_decision_message_batch_v2(
          '${ids.organization}','${ids.tryout}','${ids.division}','${ids.roster}',
          '${preview.previewToken}','${preview.digest}','SEND EXACT BATCH');
      `;
      const first = psql(confirmSql(firstName));
      await waitForBlockingEdge(firstName, holderName);
      const second = psql(confirmSql(secondName));
      await waitForBlockingEdge(secondName, firstName);
      await psql(`select pg_terminate_backend(pid) from pg_stat_activity
        where application_name='${holderName}'`);
      const results = await Promise.all([first, second]);
      const outcomes = results.map((result) => result.stdout.trim());
      const batchIds = outcomes.map((outcome) => outcome.split('|')[1]);
      expect(outcomes.map((outcome) => outcome.split('|')[0]).sort()).toEqual([
        'queued',
        'replayed',
      ]);
      expect(new Set(batchIds).size).toBe(1);
      expect(
        (
          await psql(`select
            (select count(*) from public.communication_batches where id='${batchIds[0]}')||'|'||
            (select count(*) from public.communication_messages where communication_batch_id='${batchIds[0]}')||'|'||
            (select count(*) from public.outbox_jobs where message_id in(
              select id from public.communication_messages where communication_batch_id='${batchIds[0]}'))||'|'||
            (select count(*) from public.communication_preview_tombstones where communication_batch_id='${batchIds[0]}')`)
        ).stdout.trim(),
      ).toBe('1|1|1|1');
    } finally {
      await psql(`select pg_terminate_backend(pid) from pg_stat_activity
        where application_name in('${holderName}','${firstName}','${secondName}')`).catch(
        () => undefined,
      );
      await holder;
    }
  });

  it('preserves one exact winner against concurrent mutated-digest and wrong-actor confirmations', async () => {
    const preview = JSON.parse(
      (
        await psql(`set role authenticated; select set_config('request.jwt.claim.role','authenticated',false);
          select set_config('request.jwt.claim.sub','${ids.owner}',false);
          select public.preview_decision_message_batch_v2('${ids.organization}','${ids.roster}','selected',
            'Concurrent mismatched callers stay non-oracular.','builtin:selected',1)`)
      ).stdout.trim(),
    ) as { digest: string; previewToken: string };
    const alteredDigest = `${preview.digest[0] === '0' ? '1' : '0'}${preview.digest.slice(1)}`;
    const wrongActor = '00000000-0000-4000-8000-000000000999';
    const suffix = randomUUID().slice(0, 8);
    const holderName = `message-mismatch-holder-${suffix}`;
    const exactName = `message-mismatch-exact-${suffix}`;
    const digestName = `message-mismatch-digest-${suffix}`;
    const actorName = `message-mismatch-actor-${suffix}`;
    const holder = psql(`set application_name='${holderName}'; begin;
      select id from public.roster_versions where id='${ids.roster}' for update;
      select pg_sleep(30); commit;`).then(
      () => undefined,
      () => undefined,
    );
    const confirmSql = (applicationName: string, actor: string, digest: string) => `
      set application_name='${applicationName}'; set statement_timeout='10s'; set role authenticated;
      select set_config('request.jwt.claim.role','authenticated',false);
      select set_config('request.jwt.claim.sub','${actor}',false);
      select outcome||'|'||coalesce(batch_id::text,'')||'|'||queued_count
      from public.create_decision_message_batch_v2(
        '${ids.organization}','${ids.tryout}','${ids.division}','${ids.roster}',
        '${preview.previewToken}','${digest}','SEND EXACT BATCH');`;

    try {
      await waitForSleepingSession(holderName);
      const exact = psql(confirmSql(exactName, ids.owner, preview.digest));
      await waitForBlockingEdge(exactName, holderName);
      const changedDigest = psql(confirmSql(digestName, ids.owner, alteredDigest));
      const changedActor = psql(confirmSql(actorName, wrongActor, preview.digest));
      await waitForBlockingEdge(digestName, exactName);
      await waitForBlockingEdge(actorName, exactName);
      await psql(`select pg_terminate_backend(pid) from pg_stat_activity
        where application_name='${holderName}'`);
      const [exactResult, digestResult, actorResult] = await Promise.all([
        exact,
        changedDigest,
        changedActor,
      ]);
      expect(exactResult.stdout.trim().split('|')[0]).toBe('queued');
      expect(digestResult.stdout.trim()).toBe('preview_conflict||0');
      expect(actorResult.stdout.trim()).toBe('forbidden||0');
      const batchId = exactResult.stdout.trim().split('|')[1];
      expect(
        (
          await psql(`select
            (select count(*) from public.communication_batches where id='${batchId}')||'|'||
            (select count(*) from public.communication_messages where communication_batch_id='${batchId}')||'|'||
            (select count(*) from public.outbox_jobs where message_id in(
              select id from public.communication_messages where communication_batch_id='${batchId}'))||'|'||
            (select count(*) from public.communication_preview_tombstones where communication_batch_id='${batchId}')`)
        ).stdout.trim(),
      ).toBe('1|1|1|1');
    } finally {
      await psql(`select pg_terminate_backend(pid) from pg_stat_activity
        where application_name in('${holderName}','${exactName}','${digestName}','${actorName}')`).catch(
        () => undefined,
      );
      await holder;
    }
  });

  it('serializes an expired token and lets neither simultaneous caller consume it', async () => {
    const preview = JSON.parse(
      (
        await psql(`set role authenticated; select set_config('request.jwt.claim.role','authenticated',false);
          select set_config('request.jwt.claim.sub','${ids.owner}',false);
          select public.preview_decision_message_batch_v2('${ids.organization}','${ids.roster}','selected',
            'Expired simultaneous confirmation.','builtin:selected',1)`)
      ).stdout.trim(),
    ) as { digest: string; previewToken: string };
    const tokenHash = (
      await psql(
        `select encode(extensions.digest(convert_to('${preview.previewToken}','UTF8'),'sha256'),'hex')`,
      )
    ).stdout.trim();
    await psql(`update public.communication_preview_proofs
      set issued_at=clock_timestamp()-interval '11 minutes',
        expires_at=clock_timestamp()-interval '1 minute'
      where token_digest='${tokenHash}'`);
    const suffix = randomUUID().slice(0, 8);
    const holderName = `message-expired-holder-${suffix}`;
    const firstName = `message-expired-first-${suffix}`;
    const secondName = `message-expired-second-${suffix}`;
    const holder = psql(`set application_name='${holderName}'; begin;
      select token_digest from public.communication_preview_proofs
      where token_digest='${tokenHash}' for update;
      select pg_sleep(30); commit;`).then(
      () => undefined,
      () => undefined,
    );
    const confirmSql = (applicationName: string) => `
      set application_name='${applicationName}'; set statement_timeout='10s'; set role authenticated;
      select set_config('request.jwt.claim.role','authenticated',false);
      select set_config('request.jwt.claim.sub','${ids.owner}',false);
      select outcome from public.create_decision_message_batch_v2(
        '${ids.organization}','${ids.tryout}','${ids.division}','${ids.roster}',
        '${preview.previewToken}','${preview.digest}','SEND EXACT BATCH');`;

    try {
      await waitForSleepingSession(holderName);
      const first = psql(confirmSql(firstName));
      await waitForBlockingEdge(firstName, holderName);
      const second = psql(confirmSql(secondName));
      await waitForBlockingEdge(secondName, firstName);
      await psql(`select pg_terminate_backend(pid) from pg_stat_activity
        where application_name='${holderName}'`);
      const results = await Promise.all([first, second]);
      expect(results.map((result) => result.stdout.trim())).toEqual([
        'preview_conflict',
        'preview_conflict',
      ]);
      expect(
        (
          await psql(`select
            (select count(*) from public.communication_preview_proofs where token_digest='${tokenHash}')||'|'||
            (select count(*) from public.communication_preview_tombstones where token_digest='${tokenHash}')||'|'||
            (select count(*) from public.communication_batches where preview_digest='${preview.digest}')`)
        ).stdout.trim(),
      ).toBe('1|0|0');
    } finally {
      await psql(`select pg_terminate_backend(pid) from pg_stat_activity
        where application_name in('${holderName}','${firstName}','${secondName}')`).catch(
        () => undefined,
      );
      await holder;
    }
  });

  it('durably retains an event received before provider completion and reconciles it atomically', async () => {
    const earlyMessage = randomUUID();
    const providerId = 'e6400000-0000-4000-8000-000000000099';
    const occurredAt = new Date().toISOString();
    await psql(`insert into public.communication_messages(id,organization_id,source_kind,source_id,message_kind,
      notice_class,business_idempotency_key,request_digest,recipient_snapshot,content_snapshot,state,
      source_binding_version,source_registration_id,source_guardian_id,source_roster_version_id,
      source_expected_decision,source_authorizing_user_id,source_tryout_id,source_division_id)
      values('${earlyMessage}','${ids.organization}','roster_decision','${ids.roster}','roster_decision_notice',
      'operational','task23:early:${earlyMessage}',repeat('e',64),'{"email":"decision-recipient@example.com"}',
      '{"subject":"Early","text":"Body"}','queued',1,'${ids.registration}','${ids.guardian}',
      '${ids.roster}','selected','${ids.owner}','${ids.tryout}','${ids.division}')`);
    expect(
      (
        await psql(`set role service_role; select public.apply_resend_delivery_event(
      'msg_task23early0001','${earlyMessage}','${providerId}','delivered','${occurredAt}')`)
      ).stdout.trim(),
    ).toBe('pending');
    expect(
      (
        await psql(
          `select count(*) from public.communication_pending_delivery_events where event_id='msg_task23early0001'`,
        )
      ).stdout.trim(),
    ).toBe('1');
    await expect(
      psql('truncate table public.communication_pending_delivery_events'),
    ).rejects.toThrow(/communication evidence is append-only/u);
    await expect(
      psql(
        'set session_replication_role=replica; truncate table public.communication_pending_delivery_events',
      ),
    ).rejects.toThrow(/communication evidence is append-only/u);
    await psql(`update public.communication_messages set state='submitted',provider_message_id='${providerId}',
      submitted_at=clock_timestamp() where id='${earlyMessage}'`);
    expect(
      (
        await psql(`select state||'|'||(select count(*) from public.communication_delivery_events
      where message_id='${earlyMessage}') from public.communication_messages where id='${earlyMessage}'`)
      ).stdout.trim(),
    ).toBe('delivered|1');

    const racingMessage = randomUUID();
    const racingProvider = 'e6400000-0000-4000-8000-000000000098';
    await psql(`insert into public.communication_messages(id,organization_id,source_kind,source_id,message_kind,
      notice_class,business_idempotency_key,request_digest,recipient_snapshot,content_snapshot,state,
      source_binding_version,source_registration_id,source_guardian_id,source_roster_version_id,
      source_expected_decision,source_authorizing_user_id,source_tryout_id,source_division_id)
      values('${racingMessage}','${ids.organization}','roster_decision','${ids.roster}','roster_decision_notice',
      'operational','task23:race:${racingMessage}',repeat('f',64),'{"email":"decision-recipient@example.com"}',
      '{"subject":"Race","text":"Body"}','queued',1,'${ids.registration}','${ids.guardian}',
      '${ids.roster}','selected','${ids.owner}','${ids.tryout}','${ids.division}')`);
    const raceTime = new Date().toISOString();
    await Promise.all([
      psql(`set role service_role; select public.apply_resend_delivery_event(
        'msg_task23race00001','${racingMessage}','${racingProvider}','delivered','${raceTime}')`),
      psql(`update public.communication_messages set state='submitted',provider_message_id='${racingProvider}',
        submitted_at=clock_timestamp() where id='${racingMessage}'`),
    ]);
    expect(
      (
        await psql(`select state||'|'||(select count(*) from public.communication_delivery_events
      where message_id='${racingMessage}') from public.communication_messages where id='${racingMessage}'`)
      ).stdout.trim(),
    ).toBe('delivered|1');
  });

  it('deduplicates provider events, retains out-of-order evidence, and never changes decisions', async () => {
    const providerId = 'e6400000-0000-4000-8000-000000000001';
    await psql(
      `update public.communication_messages set state='submitted',provider_message_id='${providerId}',submitted_at=clock_timestamp() where id='${messageId}'`,
    );
    const timestamps = {
      delivered: new Date(Date.now() - 2_000).toISOString(),
      sent: new Date(Date.now() - 3_000).toISOString(),
      bounced: new Date(Date.now() - 1_000).toISOString(),
    };
    const apply = (eventId: string, type: string, occurredAt: string) =>
      psql(
        `set role service_role; select public.apply_resend_delivery_event('${eventId}','${messageId}','${providerId}','${type}','${occurredAt}')`,
      );
    expect(
      (await apply('msg_task23event001', 'delivered', timestamps.delivered)).stdout.trim(),
    ).toBe('delivered');
    expect(
      (await apply('msg_task23event001', 'delivered', timestamps.delivered)).stdout.trim(),
    ).toBe('replayed');
    expect((await apply('msg_task23event002', 'sent', timestamps.sent)).stdout.trim()).toBe(
      'delivered',
    );
    expect((await apply('msg_task23event003', 'bounced', timestamps.bounced)).stdout.trim()).toBe(
      'bounced',
    );
    const result = await psql(
      `select state||'|'||(select count(*) from public.communication_delivery_events where message_id='${messageId}')||'|'||(select status from public.roster_decisions where roster_version_id='${ids.roster}' and registration_id='${ids.registration}') from public.communication_messages where id='${messageId}'`,
    );
    expect(result.stdout.trim()).toBe('bounced|3|selected');
  });

  it('serializes simultaneous duplicate webhook deliveries to one evidence row', async () => {
    const providerId = 'e6400000-0000-4000-8000-000000000001';
    const occurredAt = new Date().toISOString();
    const sql = `set role service_role; select public.apply_resend_delivery_event(
      'msg_task23concurrent001','${messageId}','${providerId}','complained','${occurredAt}')`;
    const outcomes = await Promise.all([psql(sql), psql(sql)]);
    expect(outcomes.map((outcome) => outcome.stdout.trim()).sort()).toEqual([
      'complained',
      'replayed',
    ]);
    expect(
      (
        await psql(
          `select count(*) from public.communication_delivery_events where event_id='msg_task23concurrent001'`,
        )
      ).stdout.trim(),
    ).toBe('1');
    expect(
      (
        await psql(
          `select status from public.roster_decisions where roster_version_id='${ids.roster}' and registration_id='${ids.registration}'`,
        )
      ).stdout.trim(),
    ).toBe('selected');
  });

  it('reconciles a delivery-uncertain handoff only when the event binds the exact message ID', async () => {
    const uncertainMessage = randomUUID();
    const uncertainJob = randomUUID();
    const leaseToken = randomUUID();
    const providerId = 'e6400000-0000-4000-8000-000000000002';
    await psql(`
      insert into public.communication_messages(id,organization_id,source_kind,source_id,message_kind,notice_class,
        business_idempotency_key,request_digest,recipient_snapshot,content_snapshot,state,source_binding_version,
        source_registration_id,source_roster_version_id,source_guardian_id,source_expected_decision,
        source_authorizing_user_id)
      values('${uncertainMessage}','${ids.organization}','roster_decision','${ids.roster}','roster_decision_notice','operational',
        'task23:uncertain:${uncertainMessage}',repeat('c',64),'{"email":"decision-recipient@example.com"}',
        '{"subject":"Subject","text":"Body"}','queued',1,'${ids.registration}','${ids.roster}',
        '${ids.guardian}','selected','${ids.owner}');
      insert into public.outbox_jobs(id,organization_id,message_id,business_idempotency_key,provider_idempotency_key,
        status,attempt_count,lease_owner,lease_token,lease_generation,lease_expires_at)
      values('${uncertainJob}','${ids.organization}','${uncertainMessage}','task23:uncertain:${uncertainMessage}',
        'communication:${uncertainMessage}','leased',1,'task23-worker','${leaseToken}',1,clock_timestamp()+interval '10 minutes');
    `);
    const authorization = JSON.parse(
      (
        await psql(`set role service_role; select public.authorize_outbox_job_send_v2(
          '${uncertainJob}','${leaseToken}',1,5000,1000)`)
      ).stdout.trim(),
    ) as { outcome: string; send_attempt_token: string };
    expect(authorization.outcome).toBe('authorized');
    const eventTime = new Date().toISOString();
    expect(
      (
        await psql(`set role service_role; select public.apply_resend_delivery_event(
      'msg_task23uncertain001','${uncertainMessage}','${providerId}','delivered','${eventTime}')`)
      ).stdout.trim(),
    ).toBe('pending');
    expect(
      (
        await psql(`set role service_role; select public.fail_outbox_job_v2(
          '${uncertainJob}','${leaseToken}',1,'${authorization.send_attempt_token}',
          'provider_timeout_uncertain',true)`)
      ).stdout.trim(),
    ).toBe('completed');
    const accepted = await psql(`set role service_role; select public.apply_resend_delivery_event(
      'msg_task23uncertain001','${uncertainMessage}','${providerId}','delivered','${eventTime}')`);
    expect(accepted.stdout.trim()).toBe('replayed');
    const result =
      await psql(`select message.state||'|'||message.provider_message_id||'|'||job.status||'|'||
      coalesce(job.delivery_uncertain_reason,'NULL')||'|'||handoff.attempt_state||'|'||handoff.provider_message_id
      from public.communication_messages message join public.outbox_jobs job on job.message_id=message.id
      join public.outbox_provider_handoffs handoff on handoff.job_id=job.id
      where message.id='${uncertainMessage}'`);
    expect(result.stdout.trim()).toBe(
      `delivered|${providerId}|completed|NULL|event_confirmed|${providerId}`,
    );
  });
});
