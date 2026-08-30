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
    delete from public.athlete_guardians where organization_id='${ids.organization}';
    delete from public.guardians where organization_id='${ids.organization}';
    delete from public.tryout_registrations where organization_id='${ids.organization}';
    delete from public.athletes where organization_id='${ids.organization}';
    delete from public.registration_form_versions where organization_id='${ids.organization}';
    delete from public.registration_forms where organization_id='${ids.organization}';
    delete from public.tryout_divisions where organization_id='${ids.organization}';
    delete from public.tryouts where organization_id='${ids.organization}';
    delete from public.organization_members where organization_id='${ids.organization}';
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
      insert into public.notification_preferences(organization_id,guardian_id,optional_email_enabled) values('${ids.organization}','${ids.guardian}',false);
      set session_replication_role=replica;
      update public.tryouts set status='published',published_at=clock_timestamp() where id='${ids.tryout}';
      set session_replication_role=origin;
    `);
    const operational = await psql(`
      set role authenticated; select set_config('request.jwt.claim.role','authenticated',false); select set_config('request.jwt.claim.sub','${ids.owner}',false);
      select outcome||'|'||coalesce(message_id::text,'NULL')||'|'||coalesce(job_id::text,'NULL') from public.queue_registration_communication('${ids.organization}','${ids.registration}','${ids.guardian}','registration_confirmation','operational','Registration received','Your registration was received.','${keyPrefix}-operational');
    `);
    expect(operational.stdout.trim()).toMatch(/^queued\|[0-9a-f-]{36}\|[0-9a-f-]{36}$/u);
    const replay = await psql(`
      set role authenticated; select set_config('request.jwt.claim.role','authenticated',false); select set_config('request.jwt.claim.sub','${ids.owner}',false);
      select outcome from public.queue_registration_communication('${ids.organization}','${ids.registration}','${ids.guardian}','registration_confirmation','operational','Registration received','Your registration was received.','${keyPrefix}-operational');
    `);
    expect(replay.stdout.trim()).toBe('replayed');
    const optional = await psql(`
      set role authenticated; select set_config('request.jwt.claim.role','authenticated',false); select set_config('request.jwt.claim.sub','${ids.owner}',false);
      select outcome from public.queue_registration_communication('${ids.organization}','${ids.registration}','${ids.guardian}','reminder','optional','Reminder','Reminder body','${keyPrefix}-optional');
    `);
    expect(optional.stdout.trim()).toBe('suppressed');
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
          `set role service_role; select public.complete_outbox_job('${jobId}','${token}',${generation},'forged')`,
        )
      ).stdout.trim(),
    ).toBe('lease_conflict');
    expect(
      (
        await psql(
          `set role service_role; select public.complete_outbox_job('${jobId}','${nextToken}',${nextGeneration},'provider-1')`,
        )
      ).stdout.trim(),
    ).toBe('completed');
    expect(
      (
        await psql(
          `set role service_role; select public.complete_outbox_job('${jobId}','${nextToken}',${nextGeneration},'provider-1')`,
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
        select * from public.queue_registration_communication('${ids.organization}','${ids.registration}','${ids.guardian}','registration_confirmation','operational','Subject','Body','${keyPrefix}-rollback');
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
        `set role authenticated; select set_config('request.jwt.claim.role','authenticated',false); select set_config('request.jwt.claim.sub','${ids.member}',false); select outcome from public.queue_registration_communication('${ids.organization}','${registrationId}','${ids.guardian}','registration_confirmation','operational','Subject','Body','${keyPrefix}-${registrationId}')`,
      );
    expect((await call(ids.registration)).stdout.trim()).toBe('forbidden');
    expect((await call(randomUUID())).stdout.trim()).toBe('forbidden');
  });

  it('claims concurrent bounded batches without duplicates and records retry/dead-letter truth', async () => {
    for (const [index, suffix] of ['race-a', 'race-b', 'retry', 'expiry'].entries()) {
      const queued = await psql(
        `set role authenticated; select set_config('request.jwt.claim.role','authenticated',false); select set_config('request.jwt.claim.sub','${ids.owner}',false); select outcome from public.queue_registration_communication('${ids.organization}','${ids.registration}','${ids.guardian}','registration_confirmation','operational','Subject ${suffix}','Body ${suffix}','${keyPrefix}-${suffix}')`,
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

  it('queues only an exact finalized roster decision snapshot', async () => {
    const roster = randomUUID();
    const result = await psql(`
      begin;
      set local session_replication_role=replica;
      insert into public.roster_versions(id,organization_id,tryout_id,division_id,revision_number,state,version,finalized_by_user_id,finalized_at,created_by_user_id)
        values('${roster}','${ids.organization}','${ids.tryout}','${ids.division}',1,'draft',1,null,null,'${ids.owner}');
      insert into public.roster_decisions(organization_id,tryout_id,division_id,roster_version_id,registration_id,status,changed_by_user_id,changed_at)
        values('${ids.organization}','${ids.tryout}','${ids.division}','${roster}','${ids.registration}','selected','${ids.owner}',clock_timestamp());
      update public.roster_versions set state='finalized',version=2,finalized_by_user_id='${ids.owner}',finalized_at=clock_timestamp() where id='${roster}';
      set local session_replication_role=origin;
      set local role authenticated;
      select set_config('request.jwt.claim.role','authenticated',true);
      select set_config('request.jwt.claim.sub','${ids.owner}',true);
      select
        (select outcome from public.queue_roster_decision_communication('${ids.organization}','${roster}','${ids.registration}','${ids.guardian}','selected','selected_notice','operational','Roster decision','A decision is available.','${keyPrefix}-roster'))
        ||'|'||
        (select outcome from public.queue_roster_decision_communication('${ids.organization}','${roster}','${ids.registration}','${ids.guardian}','released','released_notice','operational','Roster decision','A decision is available.','${keyPrefix}-roster-mismatch'));
    `);
    expect(result.stdout.trim()).toBe('queued|forbidden');
  });
});
