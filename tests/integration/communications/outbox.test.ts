// @vitest-environment node

import { execFile as execFileCallback } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { promisify } from 'node:util';

import { afterAll, describe, expect, it } from 'vitest';

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

afterAll(async () => {
  await psql(`
    set session_replication_role=replica;
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
        await psql(
          `set role service_role; select public.complete_outbox_job('${jobId}','${token}',${generation},'66666666-6666-4666-8666-666666666666')`,
        )
      ).stdout.trim(),
    ).toBe('lease_conflict');
    expect(
      (
        await psql(
          `set role service_role; select public.complete_outbox_job('${jobId}','${nextToken}',${nextGeneration},'55555555-5555-4555-8555-555555555555')`,
        )
      ).stdout.trim(),
    ).toBe('completed');
    expect(
      (
        await psql(
          `set role service_role; select public.complete_outbox_job('${jobId}','${nextToken}',${nextGeneration},'55555555-5555-4555-8555-555555555555')`,
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
    expect(
      (
        await psql(
          `set role service_role; select public.fail_outbox_job('${jobId}','${token}',${generation},'provider_temporary',true)`,
        )
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
    expect(
      (
        await psql(
          `set role service_role; select public.fail_outbox_job('${jobId}','${finalToken}',${finalGeneration},'provider_temporary',true)`,
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
    expect(
      (
        await psql(
          `set role service_role; select public.authorize_outbox_job_send('${confirmationJob}','${leaseToken}',1)`,
        )
      ).stdout.trim(),
    ).toBe('lease_conflict');
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
    expect(
      (
        await psql(
          `set role service_role; select public.authorize_outbox_job_send('${inFlightJob}','${inFlightLease}',1)`,
        )
      ).stdout.trim(),
    ).toBe('authorized');
    await psql(`select public.rotate_registration_confirmation_token('${ids.registration}')`);
    expect(
      (
        await psql(
          `select status||'|'||(provider_submission_started_at is not null) from public.outbox_jobs where id='${inFlightJob}'`,
        )
      ).stdout.trim(),
    ).toBe('leased|true');
    expect(
      (
        await psql(
          `set role service_role; select public.complete_outbox_job('${inFlightJob}','${inFlightLease}',1,'77777777-7777-4777-8777-777777777777')`,
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
});
