// @vitest-environment node

import { execFile as execFileCallback } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { promisify } from 'node:util';

import { afterAll, describe, expect, it, vi } from 'vitest';

import { FakeEmailProvider } from '../../../src/infrastructure/email/fake-email-provider';
import type { EmailProvider } from '../../../src/infrastructure/email/email-provider';
import { claimJobs, type JobRpcClient } from '../../../src/infrastructure/jobs/claim-jobs';
import { dispatchJob } from '../../../src/infrastructure/jobs/dispatch-job';

const execFile = promisify(execFileCallback);
const databaseUrl =
  process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const psql = (sql: string) =>
  execFile('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-At', databaseUrl, '-c', sql]);
const ids = {
  owner: randomUUID(),
  member: randomUUID(),
  organization: randomUUID(),
  tryout: randomUUID(),
  division: randomUUID(),
  form: randomUUID(),
  formVersion: randomUUID(),
  athlete: randomUUID(),
  guardian: randomUUID(),
  registration: randomUUID(),
};
const keyPrefix = `task22-${randomUUID()}`;

const authorizeSend = async (
  jobId: string,
  leaseToken: string,
  leaseGeneration: string | number,
) => {
  const result = await psql(`set role service_role; select public.authorize_outbox_job_send_v2(
    '${jobId}','${leaseToken}',${Number(leaseGeneration)},30000,10000)`);
  return JSON.parse(result.stdout.trim()) as {
    outcome: string;
    send_attempt_token: string | null;
    send_budget_ms: number;
  };
};

const completeSend = async (
  jobId: string,
  leaseToken: string,
  leaseGeneration: string | number,
  sendAttemptToken: string,
  providerMessageId: string,
) =>
  psql(`set role service_role; select public.complete_outbox_job_v2(
    '${jobId}','${leaseToken}',${Number(leaseGeneration)},'${sendAttemptToken}','${providerMessageId}')`);

const failSend = async (
  jobId: string,
  leaseToken: string,
  leaseGeneration: string | number,
  sendAttemptToken: string,
  errorCode = 'provider_temporary',
  retryable = true,
) =>
  psql(`set role service_role; select public.fail_outbox_job_v2(
    '${jobId}','${leaseToken}',${Number(leaseGeneration)},'${sendAttemptToken}','${errorCode}',${retryable})`);

const databaseJobRpc = async (name: string, args: Record<string, unknown>) => {
  const functionName = String(name);
  const argumentsSql =
    functionName === 'authorize_outbox_job_send_v2'
      ? `'${String(args.p_job_id)}','${String(args.p_lease_token)}',${Number(args.p_lease_generation)},${Number(args.p_provider_timeout_ms)},${Number(args.p_safety_margin_ms)}`
      : functionName === 'complete_outbox_job_v2'
        ? `'${String(args.p_job_id)}','${String(args.p_lease_token)}',${Number(args.p_lease_generation)},'${String(args.p_send_attempt_token)}','${String(args.p_provider_message_id)}'`
        : functionName === 'decline_outbox_job_send_v2'
          ? `'${String(args.p_job_id)}','${String(args.p_lease_token)}',${Number(args.p_lease_generation)},'${String(args.p_send_attempt_token)}','${String(args.p_reason)}'`
          : `'${String(args.p_job_id)}','${String(args.p_lease_token)}',${Number(args.p_lease_generation)},'${String(args.p_send_attempt_token)}','${String(args.p_error_code)}',${Boolean(args.p_retryable)}`;
  const result = await psql(
    `set role service_role; select public.${functionName}(${argumentsSql})`,
  );
  return {
    data:
      functionName === 'authorize_outbox_job_send_v2'
        ? (JSON.parse(result.stdout.trim()) as unknown)
        : result.stdout.trim(),
    error: null,
  };
};

afterAll(async () => {
  await psql(`
    set session_replication_role=replica;
    delete from public.outbox_provider_handoffs where organization_id='${ids.organization}';
    delete from public.outbox_jobs where organization_id='${ids.organization}';
    delete from public.communication_messages where organization_id='${ids.organization}';
    delete from public.notification_preferences where organization_id='${ids.organization}';
    delete from public.organization_invitations where organization_id='${ids.organization}';
    delete from public.athlete_guardians where organization_id='${ids.organization}';
    delete from public.guardians where organization_id='${ids.organization}';
    delete from public.registration_confirmation_tokens where organization_id='${ids.organization}';
    delete from public.tryout_registrations where organization_id='${ids.organization}';
    delete from public.athletes where organization_id='${ids.organization}';
    delete from public.registration_form_versions where organization_id='${ids.organization}';
    delete from public.registration_forms where organization_id='${ids.organization}';
    delete from public.tryout_divisions where organization_id='${ids.organization}';
    delete from public.tryouts where organization_id='${ids.organization}';
    delete from public.organization_members where organization_id='${ids.organization}';
    delete from public.audit_logs where organization_id='${ids.organization}';
    delete from public.organizations where id='${ids.organization}';
    delete from auth.users where id in('${ids.owner}','${ids.member}');
    set session_replication_role=origin;
  `);
});

describe('transactional communication outbox', () => {
  it('queues one message and job atomically, suppresses optional only, and excludes private data', async () => {
    await psql(`
      insert into auth.users(id,email) values('${ids.owner}','owner@example.com'),('${ids.member}','member@example.com');
      insert into public.organizations(id,name,slug) values('${ids.organization}','Outbox Club','outbox-${ids.organization.slice(0, 8)}');
      insert into public.organization_members(organization_id,user_id,role,status) values('${ids.organization}','${ids.owner}','owner','active');
      insert into public.organization_members(organization_id,user_id,role,status) values('${ids.organization}','${ids.member}','member','active');
      insert into public.tryouts(id,organization_id,name,slug,sport,timezone) values('${ids.tryout}','${ids.organization}','Camp','outbox-${ids.tryout.slice(0, 8)}','Hockey','America/Edmonton');
      insert into public.tryout_divisions(id,organization_id,tryout_id,name,sort_order) values('${ids.division}','${ids.organization}','${ids.tryout}','U13',0);
      insert into public.registration_forms(id,organization_id,tryout_id,name) values('${ids.form}','${ids.organization}','${ids.tryout}','Form');
      insert into public.registration_form_versions(id,organization_id,tryout_id,registration_form_id,version_number,schema,status,published_at) values('${ids.formVersion}','${ids.organization}','${ids.tryout}','${ids.form}',1,'{"fields":[]}','published',clock_timestamp());
      insert into public.athletes(id,organization_id,given_name,family_name,normalized_given_name,normalized_family_name,birth_date) values('${ids.athlete}','${ids.organization}','Ava','Smith','ava','smith','2013-01-01');
      insert into public.guardians(id,organization_id,name,email,normalized_email) values('${ids.guardian}','${ids.organization}','Taylor Smith','guardian@example.com','guardian@example.com');
      insert into public.athlete_guardians(organization_id,athlete_id,guardian_id,relationship_label,is_primary_contact,communication_permitted) values('${ids.organization}','${ids.athlete}','${ids.guardian}','Guardian',true,true);
      insert into public.tryout_registrations(id,organization_id,tryout_id,athlete_id,division_id,registration_form_version_id,responses,submission_key_digest,submission_digest) values('${ids.registration}','${ids.organization}','${ids.tryout}','${ids.athlete}','${ids.division}','${ids.formVersion}','{}',repeat('1',64),repeat('2',64));
      insert into public.registration_confirmation_tokens(organization_id,registration_id,token_digest,expires_at)
        values('${ids.organization}','${ids.registration}',repeat('3',64),clock_timestamp()+interval '1 day');
      insert into public.notification_preferences(organization_id,guardian_id,optional_email_enabled) values('${ids.organization}','${ids.guardian}',false);
      set session_replication_role=replica;
      update public.tryouts set status='published',published_at=clock_timestamp() where id='${ids.tryout}';
      set session_replication_role=origin;
    `);
    const operational = await psql(`
      set role service_role;
      select outcome||'|'||coalesce(message_id::text,'NULL')||'|'||coalesce(job_id::text,'NULL') from public.queue_registration_confirmation_communication_v2('${ids.registration}','guardian@example.com',repeat('3',64),'Registration received','Your registration was received.','${keyPrefix}-operational');
    `);
    expect(operational.stdout.trim()).toMatch(/^queued\|[0-9a-f-]{36}\|[0-9a-f-]{36}$/u);
    const replay = await psql(`
      set role service_role;
      select outcome from public.queue_registration_confirmation_communication_v2('${ids.registration}','guardian@example.com',repeat('3',64),'Registration received','Your registration was received.','${keyPrefix}-operational');
    `);
    expect(replay.stdout.trim()).toBe('replayed');
    const optional = await psql(`
      set role authenticated; select set_config('request.jwt.claim.role','authenticated',false); select set_config('request.jwt.claim.sub','${ids.owner}',false);
      select outcome from public.queue_registration_communication_v2('${ids.organization}','${ids.registration}','${ids.guardian}','registration_reminder','Reminder','Reminder body','${keyPrefix}-optional');
    `);
    expect(optional.stdout.trim()).toBe('suppressed');
    await psql(
      `update public.notification_preferences set optional_email_enabled=true where organization_id='${ids.organization}' and guardian_id='${ids.guardian}'`,
    );
    expect(
      (
        await psql(
          `select count(*)||'|'||(select count(*) from public.outbox_jobs where organization_id='${ids.organization}')||'|'||bool_and(content_snapshot::text !~* 'note|ranking|score') from public.communication_messages where organization_id='${ids.organization}'`,
        )
      ).stdout.trim(),
    ).toBe('1|1|true');
  });

  it('claims bounded jobs with lease fencing, reclaims expiry, and makes terminal ack replay-safe', async () => {
    const first = await psql(
      `set role service_role; select job_id||'|'||lease_generation||'|'||lease_token from public.claim_outbox_jobs('worker-a',1,60)`,
    );
    const [jobId, generation, token] = first.stdout.trim().split('|');
    expect(jobId).toMatch(/[0-9a-f-]{36}/u);
    expect(generation).toBe('1');
    expect(token).toMatch(/[0-9a-f-]{36}/u);
    expect(
      (
        await psql(
          `set role service_role; select count(*) from public.claim_outbox_jobs('worker-b',10,60)`,
        )
      ).stdout.trim(),
    ).toBe('0');
    await psql(
      `update public.outbox_jobs set lease_expires_at=clock_timestamp()-interval '1 second' where id='${jobId}'`,
    );
    const reclaimed = await psql(
      `set role service_role; select lease_generation||'|'||lease_token from public.claim_outbox_jobs('worker-b',1,60)`,
    );
    const [nextGeneration, nextToken] = reclaimed.stdout.trim().split('|');
    expect(nextGeneration).toBe('2');
    expect(nextToken).not.toBe(token);
    expect(
      (
        await completeSend(
          jobId!,
          token!,
          generation!,
          '66666666-6666-4666-8666-666666666667',
          '66666666-6666-4666-8666-666666666666',
        )
      ).stdout.trim(),
    ).toBe('attempt_conflict');
    const authorization = await authorizeSend(jobId!, nextToken!, nextGeneration!);
    expect(authorization.outcome).toBe('authorized');
    expect(authorization.send_attempt_token).toMatch(/[0-9a-f-]{36}/u);
    expect(
      (
        await completeSend(
          jobId!,
          nextToken!,
          nextGeneration!,
          authorization.send_attempt_token!,
          '55555555-5555-4555-8555-555555555555',
        )
      ).stdout.trim(),
    ).toBe('completed');
    expect(
      (
        await completeSend(
          jobId!,
          nextToken!,
          nextGeneration!,
          authorization.send_attempt_token!,
          '55555555-5555-4555-8555-555555555555',
        )
      ).stdout.trim(),
    ).toBe('replayed');
  });

  it('rolls back message and job together when the job insert fails', async () => {
    const before = (
      await psql(
        `select count(*) from public.communication_messages where organization_id='${ids.organization}'`,
      )
    ).stdout.trim();
    await expect(
      psql(`
        begin; set local role authenticated; select set_config('request.jwt.claim.role','authenticated',true); select set_config('request.jwt.claim.sub','${ids.owner}',true);
        select * from public.queue_registration_communication_v2('${ids.organization}','${ids.registration}','${ids.guardian}','registration_reminder','Subject','Body','${keyPrefix}-rollback');
        update public.outbox_jobs set max_attempts=0 where business_idempotency_key='${keyPrefix}-rollback';
        commit;
      `),
    ).rejects.toThrow();
    expect(
      (
        await psql(
          `select count(*) from public.communication_messages where organization_id='${ids.organization}'`,
        )
      ).stdout.trim(),
    ).toBe(before);
  });

  it('returns the same non-oracular denial for unauthorized real and unknown snapshots', async () => {
    const call = (registrationId: string) =>
      psql(
        `set role authenticated; select set_config('request.jwt.claim.role','authenticated',false); select set_config('request.jwt.claim.sub','${ids.member}',false); select outcome from public.queue_registration_communication_v2('${ids.organization}','${registrationId}','${ids.guardian}','registration_reminder','Subject','Body','${keyPrefix}-${registrationId}')`,
      );
    expect((await call(ids.registration)).stdout.trim()).toBe('forbidden');
    expect((await call(randomUUID())).stdout.trim()).toBe('forbidden');
  });

  it('claims concurrent bounded batches without duplicates and records retry/dead-letter truth', async () => {
    for (const [index, suffix] of ['race-a', 'race-b', 'retry', 'expiry'].entries()) {
      const queued = await psql(
        `set role authenticated; select set_config('request.jwt.claim.role','authenticated',false); select set_config('request.jwt.claim.sub','${ids.owner}',false); select outcome from public.queue_registration_communication_v2('${ids.organization}','${ids.registration}','${ids.guardian}','registration_reminder','Subject ${suffix}','Body ${suffix}','${keyPrefix}-${suffix}')`,
      );
      expect(queued.stdout.trim()).toBe('queued');
      await psql(
        `update public.outbox_jobs set available_at='2000-01-${String(index + 1).padStart(2, '0')}T00:00:00Z' where organization_id='${ids.organization}' and business_idempotency_key='${keyPrefix}-${suffix}'`,
      );
    }
    const [a, b] = await Promise.all([
      psql(
        `set role service_role; select job_id from public.claim_outbox_jobs('worker-race-a',1,60)`,
      ),
      psql(
        `set role service_role; select job_id from public.claim_outbox_jobs('worker-race-b',1,60)`,
      ),
    ]);
    expect(a.stdout.trim()).toMatch(/[0-9a-f-]{36}/u);
    expect(b.stdout.trim()).toMatch(/[0-9a-f-]{36}/u);
    expect(a.stdout.trim()).not.toBe(b.stdout.trim());

    const retryClaim = await psql(
      `set role service_role; select job_id||'|'||lease_token||'|'||lease_generation from public.claim_outbox_jobs('worker-retry',1,60)`,
    );
    const [jobId, token, generation] = retryClaim.stdout.trim().split('|');
    const retryAuthorization = await authorizeSend(jobId!, token!, generation!);
    expect(retryAuthorization.outcome).toBe('authorized');
    expect(
      (
        await failSend(jobId!, token!, generation!, retryAuthorization.send_attempt_token!)
      ).stdout.trim(),
    ).toBe('retry_scheduled');
    expect(
      (
        await psql(
          `select status||'|'||(available_at>clock_timestamp())||'|'||last_error_code from public.outbox_jobs where id='${jobId}'`,
        )
      ).stdout.trim(),
    ).toBe('pending|true|provider_temporary');
    await psql(
      `update public.outbox_jobs set available_at='1999-01-01T00:00:00Z',attempt_count=4 where id='${jobId}'`,
    );
    const finalClaim = await psql(
      `set role service_role; select lease_token||'|'||lease_generation from public.claim_outbox_jobs('worker-final',1,60)`,
    );
    const [finalToken, finalGeneration] = finalClaim.stdout.trim().split('|');
    const finalAuthorization = await authorizeSend(jobId!, finalToken!, finalGeneration!);
    expect(finalAuthorization.outcome).toBe('authorized');
    expect(
      (
        await failSend(
          jobId!,
          finalToken!,
          finalGeneration!,
          finalAuthorization.send_attempt_token!,
        )
      ).stdout.trim(),
    ).toBe('dead_lettered');
    expect(
      (
        await psql(
          `select job.status||'|'||message.state||'|'||(message.attention_required_at is not null) from public.outbox_jobs job join public.communication_messages message on message.id=job.message_id where job.id='${jobId}'`,
        )
      ).stdout.trim(),
    ).toBe('dead_letter|failed|true');

    await psql(
      `update public.outbox_jobs set attempt_count=4 where organization_id='${ids.organization}' and status='pending'`,
    );
    const expiryClaim = await psql(
      `set role service_role; select job_id from public.claim_outbox_jobs('worker-expiry',1,60)`,
    );
    const expiryJob = expiryClaim.stdout.trim();
    expect(expiryJob).toMatch(/[0-9a-f-]{36}/u);
    await psql(
      `update public.outbox_jobs set lease_expires_at=clock_timestamp()-interval '1 second' where id='${expiryJob}'`,
    );
    await psql(
      `set role service_role; select count(*) from public.claim_outbox_jobs('worker-sweep',1,60)`,
    );
    expect(
      (
        await psql(
          `select status||'|'||last_error_code from public.outbox_jobs where id='${expiryJob}'`,
        )
      ).stdout.trim(),
    ).toBe('dead_letter|lease_attempts_exhausted');
  });

  it('blocks on source mutation locks, cancels revoked relationships, and fences rotated leased confirmations', async () => {
    const relationshipKey = `${keyPrefix}-relationship-race`;
    const queued = await psql(`
      set role authenticated; select set_config('request.jwt.claim.role','authenticated',false); select set_config('request.jwt.claim.sub','${ids.owner}',false);
      select job_id from public.queue_registration_communication_v2('${ids.organization}','${ids.registration}','${ids.guardian}','registration_reminder','Reminder','Body','${relationshipKey}');
    `);
    const relationshipJob = queued.stdout.trim();
    expect(relationshipJob).toMatch(/[0-9a-f-]{36}/u);
    await psql(
      `update public.outbox_jobs set available_at='1800-01-01T00:00:00Z' where id='${relationshipJob}'`,
    );
    const raceName = `task22_relationship_${randomUUID().replaceAll('-', '')}`;
    const mutation = psql(`
      set application_name='${raceName}'; begin;
      delete from public.athlete_guardians where organization_id='${ids.organization}' and athlete_id='${ids.athlete}' and guardian_id='${ids.guardian}';
      select pg_sleep(0.8); commit;
    `);
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const state = await psql(
        `select coalesce(bool_or(wait_event='PgSleep'),false) from pg_stat_activity where application_name='${raceName}'`,
      );
      if (state.stdout.trim() === 't') break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    const claimStarted = Date.now();
    const claim = await psql(
      `set role service_role; select count(*) from public.claim_outbox_jobs('worker-source-race',1,60)`,
    );
    await mutation;
    expect(claim.stdout.trim()).toBe('0');
    expect(Date.now() - claimStarted).toBeGreaterThanOrEqual(500);
    expect(
      (
        await psql(
          `select status||'|'||last_error_code from public.outbox_jobs where id='${relationshipJob}'`,
        )
      ).stdout.trim(),
    ).toBe('cancelled|registration_ineligible');
    await psql(
      `insert into public.athlete_guardians(organization_id,athlete_id,guardian_id,relationship_label,is_primary_contact,communication_permitted) values('${ids.organization}','${ids.athlete}','${ids.guardian}','Guardian',true,true)`,
    );

    const rawToken = (
      await psql(`select public.rotate_registration_confirmation_token('${ids.registration}')`)
    ).stdout.trim();
    const tokenDigest = createHash('sha256').update(rawToken).digest('hex');
    const confirmation = await psql(`
      set role service_role;
      select job_id from public.queue_registration_confirmation_communication_v2('${ids.registration}','guardian@example.com','${tokenDigest}','Confirm','Token ${rawToken}','${keyPrefix}-rotate-${tokenDigest}');
    `);
    const confirmationJob = confirmation.stdout.trim();
    const leaseToken = randomUUID();
    await psql(`update public.outbox_jobs set status='leased',attempt_count=1,lease_owner='stale-worker',
      lease_token='${leaseToken}',lease_generation=1,lease_expires_at=clock_timestamp()+interval '1 minute'
      where id='${confirmationJob}'`);
    await psql(`select public.rotate_registration_confirmation_token('${ids.registration}')`);
    expect(
      (
        await psql(
          `select status||'|'||last_error_code from public.outbox_jobs where id='${confirmationJob}'`,
        )
      ).stdout.trim(),
    ).toBe('cancelled|confirmation_token_superseded');
    expect((await authorizeSend(confirmationJob, leaseToken, 1)).outcome).toBe('lease_conflict');
    expect(
      (
        await psql(
          `select count(*) from public.audit_logs audit where audit.organization_id='${ids.organization}' and audit.action='communication.cancelled'
            and audit.entity_id in (select message_id from public.outbox_jobs where id in ('${relationshipJob}'::uuid,'${confirmationJob}'::uuid))`,
        )
      ).stdout.trim(),
    ).toBe('2');

    const inFlightRaw = (
      await psql(`select public.rotate_registration_confirmation_token('${ids.registration}')`)
    ).stdout.trim();
    const inFlightDigest = createHash('sha256').update(inFlightRaw).digest('hex');
    const inFlightJob = (
      await psql(`set role service_role; select job_id from public.queue_registration_confirmation_communication_v2(
        '${ids.registration}','guardian@example.com','${inFlightDigest}','Confirm','Token ${inFlightRaw}',
        '${keyPrefix}-in-flight-${inFlightDigest}')`)
    ).stdout.trim();
    const inFlightLease = randomUUID();
    await psql(`update public.outbox_jobs set status='leased',attempt_count=1,lease_owner='in-flight-worker',
      lease_token='${inFlightLease}',lease_generation=1,lease_expires_at=clock_timestamp()+interval '1 minute'
      where id='${inFlightJob}'`);
    const inFlightAuthorization = await authorizeSend(inFlightJob, inFlightLease, 1);
    expect(inFlightAuthorization.outcome).toBe('authorized');
    await psql(`select public.rotate_registration_confirmation_token('${ids.registration}')`);
    expect(
      (
        await psql(
          `select status||'|'||(provider_submission_started_at is not null) from public.outbox_jobs where id='${inFlightJob}'`,
        )
      ).stdout.trim(),
    ).toBe('needs_attention|true');
    expect(
      (
        await completeSend(
          inFlightJob,
          inFlightLease,
          1,
          inFlightAuthorization.send_attempt_token!,
          '77777777-7777-4777-8777-777777777777',
        )
      ).stdout.trim(),
    ).toBe('completed');
  });

  it('cancels withdrawn, offboarded, superseded-roster, and revoked-invitation sources before payload release', async () => {
    const queueReminder = async (suffix: string) => {
      const result =
        await psql(`set role authenticated; select set_config('request.jwt.claim.role','authenticated',false);
        select set_config('request.jwt.claim.sub','${ids.owner}',false);
        select job_id from public.queue_registration_communication_v2('${ids.organization}','${ids.registration}','${ids.guardian}','registration_reminder','Reminder','Body','${keyPrefix}-${suffix}')`);
      return result.stdout.trim();
    };
    const withdrawnJob = await queueReminder('withdrawn');
    await psql(`update public.tryout_registrations set status='withdrawn' where id='${ids.registration}';
      update public.outbox_jobs set available_at='1800-01-02' where id='${withdrawnJob}'`);
    expect(
      (
        await psql(
          `set role service_role; select count(*) from public.claim_outbox_jobs('worker-withdrawn',1,60)`,
        )
      ).stdout.trim(),
    ).toBe('0');
    await psql(
      `update public.tryout_registrations set status='submitted' where id='${ids.registration}'`,
    );

    const offboardedJob = await queueReminder('offboarded');
    await psql(`set session_replication_role=replica;
      update public.organization_members set role='owner' where organization_id='${ids.organization}' and user_id='${ids.member}';
      update public.organization_members set status='disabled' where organization_id='${ids.organization}' and user_id='${ids.owner}';
      set session_replication_role=origin;
      update public.outbox_jobs set available_at='1800-01-03' where id='${offboardedJob}'`);
    expect(
      (
        await psql(
          `set role service_role; select count(*) from public.claim_outbox_jobs('worker-offboarded',1,60)`,
        )
      ).stdout.trim(),
    ).toBe('0');
    expect(
      (
        await psql(`select last_error_code from public.outbox_jobs where id='${offboardedJob}'`)
      ).stdout.trim(),
    ).toBe('authorizer_offboarded');
    await psql(`set session_replication_role=replica;
      update public.organization_members set status='active' where organization_id='${ids.organization}' and user_id='${ids.owner}';
      update public.organization_members set role='member' where organization_id='${ids.organization}' and user_id='${ids.member}';
      set session_replication_role=origin;`);

    const invitationId = randomUUID();
    const invitationDigest = createHash('sha256').update('invitation-token').digest('hex');
    await psql(`insert into public.organization_invitations(id,organization_id,email,role,token_digest,expires_at,created_by_user_id)
      values('${invitationId}','${ids.organization}','invitee@example.com','member','${invitationDigest}',clock_timestamp()+interval '1 day','${ids.owner}')`);
    const invitationJob = (
      await psql(`set role authenticated; select set_config('request.jwt.claim.role','authenticated',false);
        select set_config('request.jwt.claim.sub','${ids.owner}',false); select job_id from public.queue_invitation_communication_v2(
        '${ids.organization}','${invitationId}','${invitationDigest}','Invitation','Body','${keyPrefix}-invitation-revoke')`)
    ).stdout.trim();
    await psql(`update public.organization_invitations set revoked_at=clock_timestamp() where id='${invitationId}';
      update public.outbox_jobs set available_at='1800-01-04' where id='${invitationJob}'`);
    expect(
      (
        await psql(
          `set role service_role; select count(*) from public.claim_outbox_jobs('worker-invitation',1,60)`,
        )
      ).stdout.trim(),
    ).toBe('0');
    expect(
      (
        await psql(`select last_error_code from public.outbox_jobs where id='${invitationJob}'`)
      ).stdout.trim(),
    ).toBe('invitation_inactive');
  });

  it('queues only an exact finalized roster decision snapshot', async () => {
    const roster = randomUUID();
    const newerRoster = randomUUID();
    const result = await psql(`
      begin;
      create temporary table task22_roster_outcomes(sequence integer primary key,outcome text) on commit drop;
      grant select,insert on task22_roster_outcomes to authenticated;
      set local session_replication_role=replica;
      insert into public.roster_versions(id,organization_id,tryout_id,division_id,revision_number,state,version,finalized_by_user_id,finalized_at,created_by_user_id)
        values('${roster}','${ids.organization}','${ids.tryout}','${ids.division}',1,'draft',1,null,null,'${ids.owner}');
      insert into public.roster_decisions(organization_id,tryout_id,division_id,roster_version_id,registration_id,status,changed_by_user_id,changed_at)
        values('${ids.organization}','${ids.tryout}','${ids.division}','${roster}','${ids.registration}','selected','${ids.owner}',clock_timestamp());
      update public.roster_versions set state='finalized',version=2,finalized_by_user_id='${ids.owner}',finalized_at=clock_timestamp() where id='${roster}';
      set local session_replication_role=origin;
      set local role authenticated;
      set local "request.jwt.claim.role"='authenticated';
      set local "request.jwt.claim.sub"='${ids.owner}';
      insert into task22_roster_outcomes values(1,(select outcome from public.queue_roster_decision_communication_v2(
        '${ids.organization}','${roster}','${ids.registration}','${ids.guardian}','selected','roster_decision_notice',
        'Roster decision','A decision is available.','${keyPrefix}-roster')));
      insert into task22_roster_outcomes values(2,(select outcome from public.queue_roster_decision_communication_v2(
        '${ids.organization}','${roster}','${ids.registration}','${ids.guardian}','released','roster_decision_notice',
        'Roster decision','A decision is available.','${keyPrefix}-roster-mismatch')));
      reset role;
      set local session_replication_role=replica;
      insert into public.roster_versions(id,organization_id,tryout_id,division_id,revision_number,state,version,based_on_roster_version_id,revision_reason,created_by_user_id)
        values('${newerRoster}','${ids.organization}','${ids.tryout}','${ids.division}',2,'draft',1,'${roster}','Corrected finalized decision','${ids.owner}');
      insert into public.roster_decisions(organization_id,tryout_id,division_id,roster_version_id,registration_id,status,changed_by_user_id,changed_at)
        values('${ids.organization}','${ids.tryout}','${ids.division}','${newerRoster}','${ids.registration}','selected','${ids.owner}',clock_timestamp());
      update public.roster_versions set state='finalized',version=2,finalized_by_user_id='${ids.owner}',finalized_at=clock_timestamp() where id='${newerRoster}';
      set local session_replication_role=origin;
      update public.outbox_jobs set available_at='1700-01-01'
        where business_idempotency_key='${keyPrefix}-roster';
      set local role service_role;
      set local "request.jwt.claim.role"='service_role';
      do $claim$ begin perform count(*) from public.claim_outbox_jobs('worker-roster-superseded',1,60); end $claim$;
      reset role;
      select (select string_agg(outcome,'|' order by sequence) from task22_roster_outcomes)||'|'||job.status||'|'||job.last_error_code
      from public.outbox_jobs job where job.business_idempotency_key='${keyPrefix}-roster';
    `);
    expect(result.stdout.trim()).toBe('queued|forbidden|cancelled|roster_decision_superseded');
  });

  it('preserves uncertain handoff truth after source withdrawal and accepts an exact late completion', async () => {
    const queued = (
      await psql(`set role authenticated; select set_config('request.jwt.claim.role','authenticated',false);
        select set_config('request.jwt.claim.sub','${ids.owner}',false);
        select job_id from public.queue_registration_communication_v2('${ids.organization}','${ids.registration}',
          '${ids.guardian}','registration_reminder','Uncertain subject','Uncertain body','${keyPrefix}-uncertain-withdraw')`)
    ).stdout.trim();
    await psql(
      `update public.outbox_jobs set available_at='1700-01-01',max_attempts=5 where id='${queued}'`,
    );
    const claim = (
      await psql(`set role service_role; select lease_token||'|'||lease_generation
        from public.claim_outbox_jobs('worker-uncertain',1,60)`)
    ).stdout
      .trim()
      .split('|');
    const authorization = await authorizeSend(queued, claim[0]!, claim[1]!);
    expect(authorization.outcome).toBe('authorized');
    await psql(`update public.tryout_registrations set status='withdrawn' where id='${ids.registration}';
      update public.outbox_jobs set lease_expires_at=clock_timestamp()-interval '1 second' where id='${queued}'`);
    await psql(
      `set role service_role; select count(*) from public.claim_outbox_jobs('worker-withdrawn-after-handoff',1,60)`,
    );
    expect(
      (
        await psql(`select job.status||'|'||message.state||'|'||job.delivery_uncertain_reason||'|'||
          (job.provider_submission_started_at is not null) from public.outbox_jobs job
          join public.communication_messages message on message.id=job.message_id where job.id='${queued}'`)
      ).stdout.trim(),
    ).toBe('needs_attention|delivery_uncertain|registration_ineligible|true');
    expect(
      (
        await completeSend(
          queued,
          claim[0]!,
          claim[1]!,
          authorization.send_attempt_token!,
          '88888888-8888-4888-8888-888888888888',
        )
      ).stdout.trim(),
    ).toBe('completed');
    expect(
      (
        await completeSend(
          queued,
          claim[0]!,
          claim[1]!,
          authorization.send_attempt_token!,
          '88888888-8888-4888-8888-888888888888',
        )
      ).stdout.trim(),
    ).toBe('replayed');
    await psql(
      `update public.tryout_registrations set status='submitted' where id='${ids.registration}'`,
    );
  });

  it('marks offboarded and exhausted post-handoff work uncertain without automatic resend', async () => {
    const queue = async (suffix: string) =>
      (
        await psql(`set role authenticated; select set_config('request.jwt.claim.role','authenticated',false);
          select set_config('request.jwt.claim.sub','${ids.owner}',false);
          select job_id from public.queue_registration_communication_v2('${ids.organization}','${ids.registration}',
            '${ids.guardian}','registration_reminder','Attention ${suffix}','Body','${keyPrefix}-${suffix}')`)
      ).stdout.trim();
    const authorize = async (jobId: string, owner: string) => {
      await psql(`update public.outbox_jobs set available_at='1650-01-01' where id='${jobId}'`);
      const [token, generation] = (
        await psql(`set role service_role; select lease_token||'|'||lease_generation
          from public.claim_outbox_jobs('${owner}',1,60)`)
      ).stdout
        .trim()
        .split('|');
      const authorization = await authorizeSend(jobId, token!, generation!);
      expect(authorization.outcome).toBe('authorized');
      return { token, generation, sendAttemptToken: authorization.send_attempt_token };
    };

    const offboardedJob = await queue('uncertain-offboard');
    await authorize(offboardedJob, 'worker-uncertain-offboard');
    await psql(`set session_replication_role=replica;
      update public.organization_members set role='owner' where organization_id='${ids.organization}' and user_id='${ids.member}';
      update public.organization_members set status='disabled' where organization_id='${ids.organization}' and user_id='${ids.owner}';
      set session_replication_role=origin;
      update public.outbox_jobs set lease_expires_at=clock_timestamp()-interval '1 second' where id='${offboardedJob}'`);
    await psql(
      `set role service_role; select count(*) from public.claim_outbox_jobs('worker-offboard-sweep',1,60)`,
    );
    expect(
      (
        await psql(
          `select status||'|'||delivery_uncertain_reason from public.outbox_jobs where id='${offboardedJob}'`,
        )
      ).stdout.trim(),
    ).toBe('needs_attention|authorizer_offboarded');
    await psql(`set session_replication_role=replica;
      update public.organization_members set status='active' where organization_id='${ids.organization}' and user_id='${ids.owner}';
      update public.organization_members set role='member' where organization_id='${ids.organization}' and user_id='${ids.member}';
      set session_replication_role=origin`);

    const exhaustedJob = await queue('uncertain-exhausted');
    await psql(`update public.outbox_jobs set max_attempts=1 where id='${exhaustedJob}'`);
    await authorize(exhaustedJob, 'worker-uncertain-exhausted');
    await psql(`update public.outbox_jobs set lease_expires_at=clock_timestamp()-interval '1 second' where id='${exhaustedJob}';
      set role service_role; select count(*) from public.claim_outbox_jobs('worker-exhausted-sweep',1,60)`);
    expect(
      (
        await psql(
          `select status||'|'||delivery_uncertain_reason from public.outbox_jobs where id='${exhaustedJob}'`,
        )
      ).stdout.trim(),
    ).toBe('needs_attention|lease_attempts_exhausted');
  });

  it('does not invoke the provider when authorization consumes the safety budget and retries later', async () => {
    const queued = (
      await psql(`set role authenticated; select set_config('request.jwt.claim.role','authenticated',false);
        select set_config('request.jwt.claim.sub','${ids.owner}',false);
        select job_id from public.queue_registration_communication_v2('${ids.organization}','${ids.registration}',
          '${ids.guardian}','registration_reminder','Delayed authorization','Body','${keyPrefix}-delayed-auth')`)
    ).stdout.trim();
    await psql(`update public.outbox_jobs set available_at='1500-01-01' where id='${queued}'`);
    const [claimed] = await (async () => {
      const rows =
        await psql(`set role service_role; select coalesce(json_agg(row_to_json(claim)),'[]')
        from public.claim_outbox_jobs('worker-delayed-auth',1,90) claim`);
      return JSON.parse(rows.stdout.trim()) as Array<Record<string, unknown>>;
    })();
    if (!claimed) throw new Error('delayed authorization job was not claimed');
    await psql(`update public.outbox_jobs set lease_expires_at=clock_timestamp()+interval '60.5 seconds'
      where id='${queued}'`);
    const leasedJob = {
      jobId: String(claimed.job_id),
      messageId: String(claimed.message_id),
      leaseToken: String(claimed.lease_token),
      leaseGeneration: Number(claimed.lease_generation),
      leaseExpiresAt: new Date(Date.now() + 60_500).toISOString(),
      providerIdempotencyKey: String(claimed.provider_idempotency_key),
      recipientEmail: String(claimed.recipient_email),
      subject: String(claimed.subject),
      bodyText: String(claimed.body_text),
      attemptCount: Number(claimed.attempt_count),
      maxAttempts: Number(claimed.max_attempts),
    };
    const client: JobRpcClient = {
      rpc: async (name, args) => {
        const functionName = String(name);
        if (functionName === 'authorize_outbox_job_send_v2')
          await new Promise((resolve) => setTimeout(resolve, 1_000));
        const argumentSql =
          functionName === 'authorize_outbox_job_send_v2'
            ? `'${String(args.p_job_id)}','${String(args.p_lease_token)}',${Number(args.p_lease_generation)},${Number(args.p_provider_timeout_ms)},${Number(args.p_safety_margin_ms)}`
            : `'${String(args.p_job_id)}','${String(args.p_lease_token)}',${Number(args.p_lease_generation)},'${String(args.p_send_attempt_token)}','${String(args.p_reason)}'`;
        const result = await psql(
          `set role service_role; select public.${functionName}(${argumentSql})`,
        );
        return {
          data:
            functionName === 'authorize_outbox_job_send_v2'
              ? (JSON.parse(result.stdout.trim()) as unknown)
              : result.stdout.trim(),
          error: null,
        };
      },
    };
    let providerCalls = 0;
    const provider = {
      async send() {
        providerCalls += 1;
        return { providerMessageId: randomUUID() };
      },
    } satisfies EmailProvider;

    await expect(dispatchJob(client, provider, leasedJob)).resolves.toBe('retry_scheduled');
    expect(providerCalls).toBe(0);
    expect(
      (
        await psql(`select status||'|'||coalesce(last_error_code,'NULL')||'|'||(provider_submission_started_at is null)||'|'||
          (select count(*) from public.outbox_provider_handoffs where job_id=job.id)
          from public.outbox_jobs job where id='${queued}'`)
      ).stdout.trim(),
    ).toBe('leased|NULL|true|0');
    await psql(`update public.outbox_jobs set available_at='1400-01-01',
      lease_expires_at=clock_timestamp()-interval '1 second' where id='${queued}'`);
    expect(
      (
        await psql(`set role service_role; select count(*) from public.claim_outbox_jobs(
          'worker-delayed-auth-retry',1,90)`)
      ).stdout.trim(),
    ).toBe('1');
  });

  it('grants concurrent dispatch routines exactly one provider invocation', async () => {
    const queued = (
      await psql(`set role authenticated; select set_config('request.jwt.claim.role','authenticated',false);
        select set_config('request.jwt.claim.sub','${ids.owner}',false);
        select job_id from public.queue_registration_communication_v2('${ids.organization}','${ids.registration}',
          '${ids.guardian}','registration_reminder','Exclusive dispatch','Body','${keyPrefix}-exclusive-dispatch')`)
    ).stdout.trim();
    await psql(`update public.outbox_jobs set available_at='1350-01-01' where id='${queued}'`);
    const claimed = JSON.parse(
      (
        await psql(`set role service_role; select row_to_json(claim) from public.claim_outbox_jobs(
          'worker-exclusive-dispatch',1,90) claim`)
      ).stdout.trim(),
    ) as Record<string, unknown>;
    const leasedJob = {
      jobId: String(claimed.job_id),
      messageId: String(claimed.message_id),
      leaseToken: String(claimed.lease_token),
      leaseGeneration: Number(claimed.lease_generation),
      leaseExpiresAt: String(claimed.lease_expires_at),
      providerIdempotencyKey: String(claimed.provider_idempotency_key),
      recipientEmail: String(claimed.recipient_email),
      subject: String(claimed.subject),
      bodyText: String(claimed.body_text),
      attemptCount: Number(claimed.attempt_count),
      maxAttempts: Number(claimed.max_attempts),
    };
    let providerCalls = 0;
    const provider = {
      async send() {
        providerCalls += 1;
        await new Promise((resolve) => setTimeout(resolve, 100));
        return { providerMessageId: randomUUID() };
      },
    } satisfies EmailProvider;
    const client = { rpc: databaseJobRpc };

    const outcomes = await Promise.all([
      dispatchJob(client, provider, leasedJob),
      dispatchJob(client, provider, leasedJob),
    ]);
    expect(outcomes.sort()).toEqual(['completed', 'needs_attention']);
    expect(providerCalls).toBe(1);
    expect(
      (
        await psql(`select count(*)||'|'||bool_and(attempt_state='completed')
          from public.outbox_provider_handoffs where job_id='${queued}'`)
      ).stdout.trim(),
    ).toBe('1|true');
  });

  it('retains exclusive truth when the authorization response is lost', async () => {
    const queued = (
      await psql(`set role authenticated; select set_config('request.jwt.claim.role','authenticated',false);
        select set_config('request.jwt.claim.sub','${ids.owner}',false);
        select job_id from public.queue_registration_communication_v2('${ids.organization}','${ids.registration}',
          '${ids.guardian}','registration_reminder','Lost authorization','Body','${keyPrefix}-lost-authorization')`)
    ).stdout.trim();
    await psql(`update public.outbox_jobs set available_at='1325-01-01' where id='${queued}'`);
    const claimed = JSON.parse(
      (
        await psql(`set role service_role; select row_to_json(claim) from public.claim_outbox_jobs(
          'worker-lost-authorization',1,90) claim`)
      ).stdout.trim(),
    ) as Record<string, unknown>;
    const leasedJob = {
      jobId: String(claimed.job_id),
      messageId: String(claimed.message_id),
      leaseToken: String(claimed.lease_token),
      leaseGeneration: Number(claimed.lease_generation),
      leaseExpiresAt: String(claimed.lease_expires_at),
      providerIdempotencyKey: String(claimed.provider_idempotency_key),
      recipientEmail: String(claimed.recipient_email),
      subject: String(claimed.subject),
      bodyText: String(claimed.body_text),
      attemptCount: Number(claimed.attempt_count),
      maxAttempts: Number(claimed.max_attempts),
    };
    let loseAuthorization = true;
    const client: JobRpcClient = {
      rpc: async (name, args) => {
        const result = await databaseJobRpc(name, args);
        if (name === 'authorize_outbox_job_send_v2' && loseAuthorization) {
          loseAuthorization = false;
          return { data: null, error: { code: 'network' } };
        }
        return result;
      },
    };
    const provider = { send: vi.fn() } satisfies EmailProvider;

    await expect(dispatchJob(client, provider, leasedJob)).rejects.toThrow('authorization_failed');
    await expect(dispatchJob(client, provider, leasedJob)).resolves.toBe('needs_attention');
    expect(provider.send).not.toHaveBeenCalled();
    expect(
      (
        await psql(`select count(*)||'|'||bool_and(attempt_state='authorized')
          from public.outbox_provider_handoffs where job_id='${queued}'`)
      ).stdout.trim(),
    ).toBe('1|true');
  });

  it('serializes a known-not-sent decline against lease reclaim without erasing another generation', async () => {
    const queued = (
      await psql(`set role authenticated; select set_config('request.jwt.claim.role','authenticated',false);
        select set_config('request.jwt.claim.sub','${ids.owner}',false);
        select job_id from public.queue_registration_communication_v2('${ids.organization}','${ids.registration}',
          '${ids.guardian}','registration_reminder','Decline race','Body','${keyPrefix}-decline-race')`)
    ).stdout.trim();
    await psql(`update public.outbox_jobs set available_at='1300-01-01' where id='${queued}'`);
    const [token, generation] = (
      await psql(`set role service_role; select lease_token||'|'||lease_generation
        from public.claim_outbox_jobs('worker-decline-race-old',1,60)`)
    ).stdout
      .trim()
      .split('|');
    const authorization = await authorizeSend(queued, token!, generation!);
    expect(authorization.outcome).toBe('authorized');
    await psql(
      `update public.outbox_jobs set lease_expires_at=clock_timestamp()-interval '1 second' where id='${queued}'`,
    );

    const [decline, reclaim] = await Promise.all([
      psql(`set role service_role; select public.decline_outbox_job_send_v2(
        '${queued}','${token}',${generation},'${authorization.send_attempt_token}','provider_deadline_elapsed')`),
      psql(`set role service_role; select count(*) from public.claim_outbox_jobs(
        'worker-decline-race-new',1,60)`),
    ]);
    expect(['retry_scheduled', 'lease_conflict']).toContain(decline.stdout.trim());
    expect(['0', '1']).toContain(reclaim.stdout.trim());
    const final = (
      await psql(`select status||'|'||lease_generation||'|'||(provider_submission_started_at is null)||'|'||
        (select count(*) from public.outbox_provider_handoffs where job_id=job.id)
        from public.outbox_jobs job where id='${queued}'`)
    ).stdout.trim();
    expect([`pending|${generation}|true|1`, `needs_attention|${generation}|false|1`]).toContain(
      final,
    );
  });

  it('runs the FakeEmailProvider through claim, dispatch, and durable database completion', async () => {
    const queued = (
      await psql(`set role authenticated; select set_config('request.jwt.claim.role','authenticated',false);
        select set_config('request.jwt.claim.sub','${ids.owner}',false);
        select job_id from public.queue_registration_communication_v2('${ids.organization}','${ids.registration}',
          '${ids.guardian}','registration_reminder','Fake contract','Fake body','${keyPrefix}-fake-dispatch')`)
    ).stdout.trim();
    await psql(`update public.outbox_jobs set available_at='1600-01-01' where id='${queued}'`);
    let loseFirstCompletionResponse = true;
    const client: JobRpcClient = {
      rpc: async (name, args) => {
        try {
          if (name === 'claim_outbox_jobs') {
            const result =
              await psql(`set role service_role; select coalesce(json_agg(row_to_json(claim)),'[]')
              from public.claim_outbox_jobs('${String(args.p_lease_owner)}',${Number(args.p_batch_size)},${Number(args.p_lease_seconds)}) claim`);
            return { data: JSON.parse(result.stdout.trim()) as unknown, error: null };
          }
          const functionName =
            name === 'authorize_outbox_job_send_v2'
              ? name
              : name === 'complete_outbox_job_v2'
                ? name
                : 'fail_outbox_job_v2';
          const argumentsSql =
            functionName === 'authorize_outbox_job_send_v2'
              ? `'${String(args.p_job_id)}','${String(args.p_lease_token)}',${Number(args.p_lease_generation)},${Number(args.p_provider_timeout_ms)},${Number(args.p_safety_margin_ms)}`
              : functionName === 'complete_outbox_job_v2'
                ? `'${String(args.p_job_id)}','${String(args.p_lease_token)}',${Number(args.p_lease_generation)},'${String(args.p_send_attempt_token)}','${String(args.p_provider_message_id)}'`
                : `'${String(args.p_job_id)}','${String(args.p_lease_token)}',${Number(args.p_lease_generation)},'${String(args.p_send_attempt_token)}','${String(args.p_error_code)}',${Boolean(args.p_retryable)}`;
          const result = await psql(
            `set role service_role; select public.${functionName}(${argumentsSql})`,
          );
          if (functionName === 'complete_outbox_job_v2' && loseFirstCompletionResponse) {
            loseFirstCompletionResponse = false;
            return { data: null, error: { code: 'network' } };
          }
          return {
            data:
              functionName === 'authorize_outbox_job_send_v2'
                ? (JSON.parse(result.stdout.trim()) as unknown)
                : result.stdout.trim(),
            error: null,
          };
        } catch (error) {
          return { data: null, error };
        }
      },
    };
    const [job] = await claimJobs(client, {
      leaseOwner: 'worker-fake-contract',
      batchSize: 1,
      leaseSeconds: 90,
    });
    expect(job?.jobId).toBe(queued);
    const provider = new FakeEmailProvider();
    await expect(dispatchJob(client, provider, job!)).rejects.toThrow('completion_failed');
    expect(provider.submissions.size).toBe(1);
    expect(
      (
        await psql(`select job.status||'|'||message.state||'|'||message.provider_message_id
          from public.outbox_jobs job join public.communication_messages message on message.id=job.message_id
          where job.id='${queued}'`)
      ).stdout.trim(),
    ).toMatch(
      /^completed\|submitted\|[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
  });

  it('serializes confirmation queue and token rotation in both natural start orders without deadlock', async () => {
    const firstRaw = (
      await psql(`select public.rotate_registration_confirmation_token('${ids.registration}')`)
    ).stdout.trim();
    const firstDigest = createHash('sha256').update(firstRaw).digest('hex');
    const queueFirstName = `task22_queue_first_${randomUUID().replaceAll('-', '')}`;
    const queueFirst =
      psql(`set application_name='${queueFirstName}'; begin; set local role service_role;
      select outcome from public.queue_registration_confirmation_communication_v2('${ids.registration}',
        'guardian@example.com','${firstDigest}','Lock order','Queue first','${keyPrefix}-queue-first');
      reset role; select pg_sleep(0.8); commit`);
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const state = await psql(
        `select coalesce(bool_or(wait_event='PgSleep'),false) from pg_stat_activity where application_name='${queueFirstName}'`,
      );
      if (state.stdout.trim() === 't') break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    const rotateAfterQueue = psql(
      `select public.rotate_registration_confirmation_token('${ids.registration}')`,
    );
    await queueFirst;
    const secondRaw = (await rotateAfterQueue).stdout.trim();
    expect(secondRaw).toMatch(/^[0-9a-f]{64}$/u);
    const firstJobState = (
      await psql(`select job.status from public.outbox_jobs job join public.communication_messages message on message.id=job.message_id
        where message.business_idempotency_key='${keyPrefix}-queue-first'`)
    ).stdout.trim();
    expect(firstJobState).toBe('cancelled');

    const rotationFirstName = `task22_rotation_first_${randomUUID().replaceAll('-', '')}`;
    const rotationFirst = psql(`set application_name='${rotationFirstName}'; begin;
      create temporary table task22_rotated_token as
        select public.rotate_registration_confirmation_token('${ids.registration}') raw_token;
      select pg_sleep(0.8); commit; select raw_token from task22_rotated_token`);
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const state = await psql(
        `select coalesce(bool_or(wait_event='PgSleep'),false) from pg_stat_activity where application_name='${rotationFirstName}'`,
      );
      if (state.stdout.trim() === 't') break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    const staleQueue =
      psql(`set role service_role; select outcome from public.queue_registration_confirmation_communication_v2(
      '${ids.registration}','guardian@example.com','${createHash('sha256').update(secondRaw).digest('hex')}',
      'Lock order','Rotation first','${keyPrefix}-rotation-first-stale')`);
    const rotationOutput = await rotationFirst;
    expect((await staleQueue).stdout.trim()).toBe('forbidden');
    const thirdRaw = rotationOutput.stdout
      .trim()
      .split('\n')
      .find((line) => /^[0-9a-f]{64}$/u.test(line));
    expect(thirdRaw).toBeDefined();
    const current = (
      await psql(`set role service_role; select outcome from public.queue_registration_confirmation_communication_v2(
        '${ids.registration}','guardian@example.com','${createHash('sha256').update(thirdRaw!).digest('hex')}',
        'Lock order','Current token','${keyPrefix}-rotation-first-current')`)
    ).stdout.trim();
    expect(current).toBe('queued');
    expect(
      (
        await psql(`select count(*) from public.outbox_jobs job join public.communication_messages message on message.id=job.message_id
          where message.source_registration_id='${ids.registration}' and message.message_kind='registration_confirmation'
            and job.status in ('pending','leased')`)
      ).stdout.trim(),
    ).toBe('1');
  });
});
