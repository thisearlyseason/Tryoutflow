// @vitest-environment node

import { execFile as execFileCallback, execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { dispatchIntegrationJob } from '../../../src/infrastructure/integrations/dispatch-integration-job';
import { MockTheSquadProvider } from '../../../src/infrastructure/integrations/mock-the-squad-provider';
import type { IntegrationDispatchGateway } from '../../../src/infrastructure/integrations/dispatch-integration-job';
import type { Json } from '../../../src/infrastructure/supabase/database.types';
import { dumpLocalSupabaseSchemas } from '../../../scripts/lib/local-supabase-database.mjs';
import {
  confirmedRosterExportSchema,
  finalizedRosterSnapshotSchema,
  rosterExportPreviewSchema,
  syncJobResultSchema,
} from '../../../src/modules/integrations/domain/contracts';

const execFile = promisify(execFileCallback);
const primaryDatabaseUrl =
  process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const runId = process.env.TRYOUTFLOW_INTEGRATION_RUN_ID;
if (!runId || !/^[0-9a-f]{16}$/u.test(runId)) {
  throw new Error('integration export requires a validated run ID');
}
const databaseName = `tryoutflow_integrations_${runId}_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
const databaseUrl = new URL(primaryDatabaseUrl);
databaseUrl.pathname = `/${databaseName}`;

beforeAll(() => {
  execFileSync('psql', [
    primaryDatabaseUrl,
    '-v',
    'ON_ERROR_STOP=1',
    '-c',
    `create database ${databaseName}`,
  ]);
  execFileSync('psql', [
    databaseUrl.toString(),
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
  ]);
  const schema = dumpLocalSupabaseSchemas(primaryDatabaseUrl, ['public', 'private']);
  execFileSync('psql', [databaseUrl.toString(), '-v', 'ON_ERROR_STOP=1'], {
    input: schema,
    maxBuffer: 60 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
});

afterAll(() => {
  execFileSync('psql', [
    primaryDatabaseUrl,
    '-v',
    'ON_ERROR_STOP=1',
    '-c',
    `drop database if exists ${databaseName} with (force)`,
  ]);
});

const psql = (sql: string) =>
  execFile('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-At', databaseUrl.toString(), '-c', sql]);
const lastLine = (output: string) => output.trim().split('\n').filter(Boolean).at(-1) ?? '';
const jsonSql = (value: unknown) => `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;
const textArraySql = (values: readonly string[]) =>
  `array[${values.map((value) => `'${value.replaceAll("'", "''")}'`).join(',')}]::text[]`;
const asActor = (actorId: string, sql: string) =>
  psql(
    `set role authenticated; select set_config('request.jwt.claim.role','authenticated',false); select set_config('request.jwt.claim.sub','${actorId}',false); ${sql};`,
  );
const asService = (sql: string) =>
  psql(
    `set role service_role; select set_config('request.jwt.claim.role','service_role',false); ${sql};`,
  );

describe('durable mock roster export', () => {
  it('deduplicates confirmation and mappings, preserves completed items, and retries only failed items', async () => {
    const ids = {
      owner: randomUUID(),
      organization: randomUUID(),
      tryout: randomUUID(),
      division: randomUUID(),
      form: randomUUID(),
      formVersion: randomUUID(),
      athleteA: randomUUID(),
      athleteB: randomUUID(),
      registrationA: '20000000-0000-4000-8000-000000000001',
      registrationB: '20000000-0000-4000-8000-000000000002',
      team: randomUUID(),
      roster: randomUUID(),
    };
    await psql(`
      insert into auth.users(id,email) values('${ids.owner}','task27-owner@example.test');
      insert into public.organizations(id,name,slug) values('${ids.organization}','Task 27 Club','task27-${ids.organization.slice(0, 8)}');
      insert into public.organization_members(organization_id,user_id,role,status) values('${ids.organization}','${ids.owner}','owner','active');
      insert into public.tryouts(id,organization_id,name,slug,sport,timezone) values('${ids.tryout}','${ids.organization}','Task 27 Tryout','task27-${ids.tryout.slice(0, 8)}','Hockey','America/Edmonton');
      insert into public.tryout_divisions(id,organization_id,tryout_id,name,sort_order) values('${ids.division}','${ids.organization}','${ids.tryout}','U18',0);
      insert into public.registration_forms(id,organization_id,tryout_id,name) values('${ids.form}','${ids.organization}','${ids.tryout}','Form');
      insert into public.registration_form_versions(id,organization_id,tryout_id,registration_form_id,version_number,schema,status,published_at)
        values('${ids.formVersion}','${ids.organization}','${ids.tryout}','${ids.form}',1,'{"fields":[]}','published',clock_timestamp());
      insert into public.athletes(id,organization_id,given_name,family_name,normalized_given_name,normalized_family_name,birth_date) values
        ('${ids.athleteA}','${ids.organization}','Synthetic','Athlete One','synthetic','athlete one','2010-01-01'),
        ('${ids.athleteB}','${ids.organization}','Synthetic','Athlete Two','synthetic','athlete two','2010-01-02');
      insert into public.tryout_registrations(id,organization_id,tryout_id,athlete_id,division_id,registration_form_version_id,responses,submission_key_digest,submission_digest) values
        ('${ids.registrationA}','${ids.organization}','${ids.tryout}','${ids.athleteA}','${ids.division}','${ids.formVersion}','{}',repeat('a',64),repeat('1',64)),
        ('${ids.registrationB}','${ids.organization}','${ids.tryout}','${ids.athleteB}','${ids.division}','${ids.formVersion}','{}',repeat('b',64),repeat('2',64));
      set session_replication_role=replica;
      update public.tryouts set status='published',published_at=clock_timestamp() where id='${ids.tryout}';
      set session_replication_role=origin;
      insert into public.tryout_teams(id,organization_id,tryout_id,division_id,name,sort_order) values('${ids.team}','${ids.organization}','${ids.tryout}','${ids.division}','Blue',0);
      insert into public.roster_versions(id,organization_id,tryout_id,division_id,revision_number,state,version,created_by_user_id)
        values('${ids.roster}','${ids.organization}','${ids.tryout}','${ids.division}',1,'draft',1,'${ids.owner}');
      insert into public.roster_decisions(organization_id,tryout_id,division_id,roster_version_id,registration_id) values
        ('${ids.organization}','${ids.tryout}','${ids.division}','${ids.roster}','${ids.registrationA}'),
        ('${ids.organization}','${ids.tryout}','${ids.division}','${ids.roster}','${ids.registrationB}');
      insert into public.roster_assignments(organization_id,tryout_id,division_id,roster_version_id,registration_id,team_id,assigned_by_user_id) values
        ('${ids.organization}','${ids.tryout}','${ids.division}','${ids.roster}','${ids.registrationA}','${ids.team}','${ids.owner}'),
        ('${ids.organization}','${ids.tryout}','${ids.division}','${ids.roster}','${ids.registrationB}','${ids.team}','${ids.owner}');
      update public.roster_versions set state='finalized',version=2,finalized_by_user_id='${ids.owner}',finalized_at=clock_timestamp() where id='${ids.roster}';
    `);

    const provider = new MockTheSquadProvider({ fixture: 'partial-failure' });
    const challenge = await provider.beginConnection({
      organizationId: ids.organization,
      actorId: ids.owner,
      correlationId: 'correlation:task27:connect',
      idempotencyKey: 'connection:task27:0001',
      callbackUrl: 'https://mock.tryoutflow.invalid/callback',
    });
    const connected = await provider.completeConnection({
      organizationId: ids.organization,
      actorId: ids.owner,
      correlationId: 'correlation:task27:connect',
      idempotencyKey: 'connection:task27:0001',
      challengeId: challenge.challengeId,
      callbackParameters: { mockApproval: 'approved' },
    });
    expect(
      lastLine(
        (
          await asActor(
            ids.owner,
            `select public.save_integration_connection('${ids.organization}','the-squad','${connected.connectionId}','The Squad (demo/mock)',true)`,
          )
        ).stdout,
      ),
    ).toBe('connected');

    const contextRow = JSON.parse(
      lastLine(
        (
          await asActor(
            ids.owner,
            `select row_to_json(context) from public.load_roster_export_context('${ids.organization}','${connected.connectionId}','${ids.roster}') context`,
          )
        ).stdout,
      ),
    ) as { roster: Json };
    const roster = finalizedRosterSnapshotSchema.parse(contextRow.roster);
    const destination = (
      await provider.listDestinations(
        {
          organizationId: ids.organization,
          actorId: ids.owner,
          connectionId: connected.connectionId,
          correlationId: 'correlation:task27:list',
          idempotencyKey: 'destination:task27:0001',
        },
        (
          await provider.listOrganizations({
            organizationId: ids.organization,
            actorId: ids.owner,
            connectionId: connected.connectionId,
            correlationId: 'correlation:task27:list',
            idempotencyKey: 'destination:task27:0001',
          })
        )[0]!,
      )
    )[0]!;
    const approvedFields = ['first_name', 'last_name', 'team_name'] as const;
    const providerContext = {
      organizationId: ids.organization,
      actorId: ids.owner,
      connectionId: connected.connectionId,
      correlationId: 'correlation:task27:preview',
      idempotencyKey: 'preview:task27:0000001',
    };
    const preview = rosterExportPreviewSchema.parse(
      await provider.previewRosterExport(providerContext, {
        destination,
        approvedFields: [...approvedFields],
        roster,
      }),
    );
    const payloadDigest = preview.snapshotDigest;
    expect(
      lastLine(
        (
          await asActor(
            ids.owner,
            `select public.save_roster_export_preview('${ids.organization}','${connected.connectionId}','${ids.roster}',${jsonSql(destination)},${textArraySql(approvedFields)},'${preview.previewId}','${preview.confirmationToken}','${preview.snapshotDigest}',${jsonSql(preview)},'${payloadDigest}')`,
          )
        ).stdout,
      ),
    ).toBe('created');

    const confirmationSql = `select row_to_json(result) from public.confirm_roster_export_preview('${ids.organization}','${preview.previewId}','${preview.confirmationToken}','export:task27:0000001') result`;
    const first = JSON.parse(lastLine((await asActor(ids.owner, confirmationSql)).stdout)) as {
      outcome: string;
      job_id: string;
    };
    const second = JSON.parse(lastLine((await asActor(ids.owner, confirmationSql)).stdout)) as {
      outcome: string;
      job_id: string;
    };
    expect(first.outcome).toBe('queued');
    expect(second).toEqual({ outcome: 'replayed', job_id: first.job_id });

    let completionFailure = '';
    const gateway: IntegrationDispatchGateway = {
      authorize: async (input) =>
        lastLine(
          (
            await asService(
              `select public.authorize_integration_outbox_submission('${input.outboxJobId}','${input.leaseToken}',${input.leaseGeneration})`,
            )
          ).stdout,
        ) as Awaited<ReturnType<IntegrationDispatchGateway['authorize']>>,
      complete: async (input) => {
        try {
          return lastLine(
            (
              await asService(
                `select public.complete_integration_outbox_job('${input.outboxJobId}','${input.leaseToken}',${input.leaseGeneration},'${input.externalJobId}',${jsonSql(syncJobResultSchema.parse(input.result))})`,
              )
            ).stdout,
          ) as Awaited<ReturnType<IntegrationDispatchGateway['complete']>>;
        } catch (error) {
          completionFailure = error instanceof Error ? error.message : String(error);
          throw error;
        }
      },
      fail: async (input) =>
        lastLine(
          (
            await asService(
              `select public.fail_integration_outbox_job('${input.outboxJobId}','${input.leaseToken}',${input.leaseGeneration},'${input.errorCode}',${input.retryable})`,
            )
          ).stdout,
        ) as Awaited<ReturnType<IntegrationDispatchGateway['fail']>>,
    };
    const claim = async () => {
      const raw = lastLine(
        (
          await asService(
            `select coalesce(json_agg(row_to_json(job)),'[]') from public.claim_integration_outbox_jobs('task27-worker',1,90) job`,
          )
        ).stdout,
      );
      const rows = JSON.parse(raw) as Array<Record<string, unknown>>;
      const row = rows[0]!;
      return {
        outboxJobId: String(row.outbox_job_id),
        syncJobId: String(row.sync_job_id),
        organizationId: String(row.organization_id),
        connectionId: String(row.connection_id),
        providerKey: String(row.provider_key),
        actorUserId: String(row.actor_user_id),
        leaseToken: String(row.lease_token),
        leaseGeneration: Number(row.lease_generation),
        leaseExpiresAt: String(row.lease_expires_at),
        providerIdempotencyKey: String(row.provider_idempotency_key),
        attemptNumber: Number(row.attempt_number),
        itemKeys: row.item_keys as string[],
        confirmedRequest: confirmedRosterExportSchema.parse(row.confirmed_request),
      };
    };

    expect(
      await dispatchIntegrationJob(await claim(), { providers: { get: () => provider }, gateway }),
      completionFailure,
    ).toBe('completed');
    expect(
      lastLine(
        (await psql(`select state from public.integration_sync_jobs where id='${first.job_id}'`))
          .stdout,
      ),
    ).toBe('partially_completed');
    expect(
      lastLine(
        (
          await psql(
            `select count(*) from public.external_entity_mappings where organization_id='${ids.organization}'`,
          )
        ).stdout,
      ),
    ).toBe('1');

    const retry = JSON.parse(
      lastLine(
        (
          await asActor(
            ids.owner,
            `select row_to_json(result) from public.retry_integration_sync_job('${ids.organization}','${first.job_id}','retry:task27:00000001') result`,
          )
        ).stdout,
      ),
    ) as { outcome: string; retried_item_count: number; preserved_completed_item_count: number };
    expect(retry).toMatchObject({
      outcome: 'queued',
      retried_item_count: 1,
      preserved_completed_item_count: 1,
    });
    const retryClaim = await claim();
    expect(retryClaim.itemKeys).toEqual([`athlete:${ids.registrationB}`]);
    expect(
      await dispatchIntegrationJob(retryClaim, { providers: { get: () => provider }, gateway }),
    ).toBe('completed');
    expect(
      lastLine(
        (await psql(`select state from public.integration_sync_jobs where id='${first.job_id}'`))
          .stdout,
      ),
    ).toBe('completed');
    expect(
      lastLine(
        (
          await psql(
            `select count(*) from public.external_entity_mappings where organization_id='${ids.organization}'`,
          )
        ).stdout,
      ),
    ).toBe('2');
    expect(
      lastLine(
        (
          await psql(
            `select count(*) from public.integration_sync_items where sync_job_id='${first.job_id}' and state='completed'`,
          )
        ).stdout,
      ),
    ).toBe('2');

    const emptyDivision = randomUUID();
    const emptyTeam = randomUUID();
    const emptyRoster = randomUUID();
    await psql(`
      set session_replication_role=replica;
      insert into public.tryout_divisions(id,organization_id,tryout_id,name,sort_order)
        values('${emptyDivision}','${ids.organization}','${ids.tryout}','Empty division',1);
      insert into public.tryout_teams(id,organization_id,tryout_id,division_id,name,sort_order)
        values('${emptyTeam}','${ids.organization}','${ids.tryout}','${emptyDivision}','Empty team',0);
      set session_replication_role=origin;
      insert into public.roster_versions(
        id,organization_id,tryout_id,division_id,revision_number,state,version,
        finalized_by_user_id,finalized_at,created_by_user_id
      ) values(
        '${emptyRoster}','${ids.organization}','${ids.tryout}','${emptyDivision}',1,'finalized',1,
        '${ids.owner}',clock_timestamp(),'${ids.owner}'
      );
    `);
    const emptyContextRow = JSON.parse(
      lastLine(
        (
          await asActor(
            ids.owner,
            `select row_to_json(context) from public.load_roster_export_context('${ids.organization}','${connected.connectionId}','${emptyRoster}') context`,
          )
        ).stdout,
      ),
    ) as { roster: Json };
    const emptySnapshot = finalizedRosterSnapshotSchema.parse(emptyContextRow.roster);
    const emptyProviderContext = {
      ...providerContext,
      correlationId: 'correlation:task27:empty-preview',
      idempotencyKey: 'preview:task27:empty:0001',
    };
    const emptyPreview = rosterExportPreviewSchema.parse(
      await provider.previewRosterExport(emptyProviderContext, {
        destination,
        approvedFields: [...approvedFields],
        roster: emptySnapshot,
      }),
    );
    expect(emptyPreview.totalItems).toBe(0);
    expect(
      lastLine(
        (
          await asActor(
            ids.owner,
            `select public.save_roster_export_preview('${ids.organization}','${connected.connectionId}','${emptyRoster}',${jsonSql(destination)},${textArraySql(approvedFields)},'${emptyPreview.previewId}','${emptyPreview.confirmationToken}','${emptyPreview.snapshotDigest}',${jsonSql(emptyPreview)},'${emptyPreview.snapshotDigest}')`,
          )
        ).stdout,
      ),
    ).toBe('created');
    const emptyConfirmation = JSON.parse(
      lastLine(
        (
          await asActor(
            ids.owner,
            `select row_to_json(result) from public.confirm_roster_export_preview('${ids.organization}','${emptyPreview.previewId}','${emptyPreview.confirmationToken}','export:task27:empty:0001') result`,
          )
        ).stdout,
      ),
    ) as { outcome: string; job_id: string | null };
    expect(emptyConfirmation.outcome).toBe('queued');
    expect(emptyConfirmation.job_id).not.toBeNull();
    expect(
      lastLine(
        (
          await psql(
            `select state from public.integration_sync_jobs where id='${emptyConfirmation.job_id}'`,
          )
        ).stdout,
      ),
    ).toBe('completed');
    expect(
      lastLine(
        (
          await psql(
            `select count(*) from public.integration_outbox_jobs where sync_job_id='${emptyConfirmation.job_id}'`,
          )
        ).stdout,
      ),
    ).toBe('0');
  });
});
