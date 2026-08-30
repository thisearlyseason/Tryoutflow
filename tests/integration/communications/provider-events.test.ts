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
const ids = {
  owner: randomUUID(),
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
    alter table public.communication_delivery_events disable trigger prevent_communication_delivery_events_mutation;
    delete from public.communication_delivery_events where organization_id='${ids.organization}';
    alter table public.communication_delivery_events enable always trigger prevent_communication_delivery_events_mutation;
    delete from public.outbox_provider_handoffs where organization_id='${ids.organization}';
    delete from public.outbox_jobs where organization_id='${ids.organization}';
    delete from public.communication_messages where organization_id='${ids.organization}';
    alter table public.communication_batches disable trigger prevent_communication_batches_mutation;
    delete from public.communication_batches where organization_id='${ids.organization}';
    alter table public.communication_batches enable always trigger prevent_communication_batches_mutation;
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
    delete from public.tryout_divisions where organization_id='${ids.organization}';
    delete from public.tryouts where organization_id='${ids.organization}';
    delete from public.organization_members where organization_id='${ids.organization}';
    delete from public.audit_logs where organization_id='${ids.organization}';
    delete from public.organizations where id='${ids.organization}';
    delete from auth.users where id='${ids.owner}';
    set session_replication_role=origin;
  `);
});

describe('decision batches and provider evidence', () => {
  it('creates the exact confirmed batch atomically and replays without changing the decision', async () => {
    await psql(`
      insert into auth.users(id,email) values('${ids.owner}','owner-${ids.owner}@example.com');
      insert into public.organizations(id,name,slug) values('${ids.organization}','Badlands Hockey Academy','${slug}');
      insert into public.organization_members(organization_id,user_id,role,status) values('${ids.organization}','${ids.owner}','owner','active');
      insert into public.tryouts(id,organization_id,name,slug,sport,timezone) values('${ids.tryout}','${ids.organization}','U15 Competitive Tryout','${slug}-tryout','Hockey','America/Edmonton');
      insert into public.tryout_divisions(id,organization_id,tryout_id,name,sort_order) values('${ids.division}','${ids.organization}','${ids.tryout}','U15',0);
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
      select public.preview_decision_message_batch('${ids.organization}','${ids.roster}','selected','Welcome to the program.');
    `);
    const data = JSON.parse(preview.stdout.trim()) as {
      digest: string;
      rosterVersion: number;
      recipients: { registrationId: string }[];
    };
    expect(data).toMatchObject({
      rosterVersion: 7,
      recipients: [{ registrationId: ids.registration }],
    });
    await psql(
      `update public.organizations set name='Changed after preview' where id='${ids.organization}'`,
    );
    const protectedFactConflict = await psql(`
      set role authenticated; select set_config('request.jwt.claim.role','authenticated',false); select set_config('request.jwt.claim.sub','${ids.owner}',false);
      select outcome from public.create_decision_message_batch(
        '${ids.organization}','${ids.roster}',7,'selected','Welcome to the program.','${data.digest}',array['${ids.registration}'::uuid],'SEND EXACT BATCH');
    `);
    expect(protectedFactConflict.stdout.trim()).toBe('preview_conflict');
    await psql(
      `update public.organizations set name='Badlands Hockey Academy' where id='${ids.organization}'`,
    );
    const createSql = `
      begin;
      set role authenticated; select set_config('request.jwt.claim.role','authenticated',false); select set_config('request.jwt.claim.sub','${ids.owner}',false);
      select outcome||'|'||batch_id||'|'||queued_count from public.create_decision_message_batch(
        '${ids.organization}','${ids.roster}',7,'selected','Welcome to the program.','${data.digest}',array['${ids.registration}'::uuid],'SEND EXACT BATCH');
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
    expect(
      (
        await psql(`set role service_role; select public.fail_outbox_job_v2(
          '${uncertainJob}','${leaseToken}',1,'${authorization.send_attempt_token}',
          'provider_timeout_uncertain',true)`)
      ).stdout.trim(),
    ).toBe('needs_attention');
    const eventTime = new Date().toISOString();
    const accepted = await psql(`set role service_role; select public.apply_resend_delivery_event(
      'msg_task23uncertain001','${uncertainMessage}','${providerId}','delivered','${eventTime}')`);
    expect(accepted.stdout.trim()).toBe('delivered');
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
