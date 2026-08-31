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
      backupOwner: randomUUID(),
      organization: randomUUID(),
      tryout: randomUUID(),
      division: randomUUID(),
      form: randomUUID(),
      formVersion: randomUUID(),
      athleteA: randomUUID(),
      athleteB: randomUUID(),
      guardianA: randomUUID(),
      registrationA: '20000000-0000-4000-8000-000000000001',
      registrationB: '20000000-0000-4000-8000-000000000002',
      team: randomUUID(),
      roster: randomUUID(),
    };
    await psql(`
      insert into auth.users(id,email) values
        ('${ids.owner}','task27-owner@example.test'),
        ('${ids.backupOwner}','task27-backup-owner@example.test');
      insert into public.organizations(id,name,slug) values('${ids.organization}','Task 27 Club','task27-${ids.organization.slice(0, 8)}');
      insert into public.organization_members(organization_id,user_id,role,status) values('${ids.organization}','${ids.owner}','owner','active');
      insert into public.organization_members(organization_id,user_id,role,status) values('${ids.organization}','${ids.backupOwner}','owner','active');
      insert into public.tryouts(id,organization_id,name,slug,sport,timezone) values('${ids.tryout}','${ids.organization}','Task 27 Tryout','task27-${ids.tryout.slice(0, 8)}','Hockey','America/Edmonton');
      insert into public.tryout_divisions(id,organization_id,tryout_id,name,sort_order) values('${ids.division}','${ids.organization}','${ids.tryout}','U18',0);
      insert into public.registration_forms(id,organization_id,tryout_id,name) values('${ids.form}','${ids.organization}','${ids.tryout}','Form');
      insert into public.registration_form_versions(id,organization_id,tryout_id,registration_form_id,version_number,schema,status,published_at)
        values('${ids.formVersion}','${ids.organization}','${ids.tryout}','${ids.form}',1,'{"fields":[]}','published',clock_timestamp());
      insert into public.athletes(id,organization_id,given_name,family_name,normalized_given_name,normalized_family_name,birth_date) values
        ('${ids.athleteA}','${ids.organization}','Synthetic','Athlete One','synthetic','athlete one','2010-01-01'),
        ('${ids.athleteB}','${ids.organization}','Synthetic','Athlete Two','synthetic','athlete two','2010-01-02');
      insert into public.guardians(id,organization_id,name,email,normalized_email,phone)
        values('${ids.guardianA}','${ids.organization}','Private Guardian','withheld-guardian@example.test','withheld-guardian@example.test','+1 403 555 0199');
      insert into public.athlete_guardians(organization_id,athlete_id,guardian_id,is_primary_contact)
        values('${ids.organization}','${ids.athleteA}','${ids.guardianA}',true);
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
    const source = JSON.parse(
      lastLine(
        (
          await asActor(
            ids.owner,
            `select row_to_json(result) from public.issue_roster_export_source('${ids.organization}','${connected.connectionId}','${ids.roster}',${jsonSql(destination)},${textArraySql(approvedFields)}) result`,
          )
        ).stdout,
      ),
    ) as { outcome: string; source_id: string; source_digest: string; roster: Json };
    expect(source.outcome).toBe('ok');
    const roster = finalizedRosterSnapshotSchema.parse(source.roster);
    await expect(
      asActor(
        ids.owner,
        `select roster_snapshot from public.integration_export_previews where id='${source.source_id}'`,
      ),
    ).rejects.toThrow(/permission denied/iu);
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
    const issueAdditionalSource = async () =>
      JSON.parse(
        lastLine(
          (
            await asActor(
              ids.owner,
              `select row_to_json(result) from public.issue_roster_export_source('${ids.organization}','${connected.connectionId}','${ids.roster}',${jsonSql(destination)},${textArraySql(approvedFields)}) result`,
            )
          ).stdout,
        ),
      ) as { source_id: string; source_digest: string };
    const saveVariant = async (
      suffix: string,
      mutate: (items: typeof preview.items) => typeof preview.items,
    ) => {
      const variantSource = await issueAdditionalSource();
      const previewId = `preview:task27:cas:${suffix}`;
      const confirmationToken = `confirmation:task27:cas:${suffix}`;
      const variant = {
        ...preview,
        previewId,
        confirmationToken,
        items: mutate(preview.items),
      };
      return lastLine(
        (
          await asActor(
            ids.owner,
            `select public.save_roster_export_preview_v2('${ids.organization}','${variantSource.source_id}','${variantSource.source_digest}','${previewId}','${confirmationToken}',${jsonSql(variant)})`,
          )
        ).stdout,
      );
    };
    await expect(
      saveVariant('duplicate-a-omit-b', (items) => [items[0]!, items[0]!]),
    ).resolves.toBe('conflict');
    await expect(
      saveVariant('operation-tamper', (items) => [
        { ...items[0]!, operation: 'skip' as const },
        items[1]!,
      ]),
    ).resolves.toBe('conflict');
    await expect(
      saveVariant('operation-missing', (items) => [
        { ...items[0]!, operation: undefined } as unknown as (typeof items)[number],
        items[1]!,
      ]),
    ).resolves.toBe('conflict');
    await expect(
      saveVariant('label-tamper', (items) => [
        { ...items[0]!, displayLabel: 'Unapproved label' },
        items[1]!,
      ]),
    ).resolves.toBe('conflict');
    await expect(saveVariant('reverse-order', (items) => [...items].reverse())).resolves.toBe(
      'created',
    );
    await psql(
      `update public.athletes set given_name='Changed after immutable source' where organization_id='${ids.organization}' and id='${ids.athleteA}'`,
    );
    expect(
      lastLine(
        (
          await asActor(
            ids.owner,
            `select public.save_roster_export_preview_v2('${ids.organization}','${source.source_id}','${source.source_digest}','${preview.previewId}','${preview.confirmationToken}',${jsonSql(preview)})`,
          )
        ).stdout,
      ),
    ).toBe('created');
    expect(
      lastLine(
        (
          await asActor(
            ids.owner,
            `select public.save_roster_export_preview_v2('${ids.organization}','${source.source_id}','${source.source_digest}','${preview.previewId}','confirmation:task27:changed:01',${jsonSql({ ...preview, confirmationToken: 'confirmation:task27:changed:01' })})`,
          )
        ).stdout,
      ),
    ).toBe('conflict');

    const confirmationSql = `select row_to_json(result) from public.confirm_roster_export_preview_v2('${ids.organization}','${preview.previewId}','${preview.confirmationToken}','export:task27:0000001') result`;
    const [firstOutput, secondOutput] = await Promise.all([
      asActor(ids.owner, confirmationSql),
      asActor(ids.owner, confirmationSql),
    ]);
    const confirmations = [firstOutput, secondOutput].map((output) =>
      JSON.parse(lastLine(output.stdout)),
    ) as Array<{
      outcome: string;
      job_id: string;
    }>;
    const first = confirmations.find((result) => result.outcome === 'queued')!;
    const second = confirmations.find((result) => result.outcome === 'replayed')!;
    expect(first.outcome).toBe('queued');
    expect(second).toMatchObject({ outcome: 'replayed', job_id: first.job_id });
    expect(
      lastLine(
        (
          await psql(
            `select (roster_snapshot is null and provider_confirmation_token is null and approved_projection::text like '%Synthetic%' and approved_projection::text not like '%Changed after%' and approved_projection::text not like '%withheld-guardian%' and approved_projection::text not like '%@%') from public.integration_sync_jobs where id='${first.job_id}'`,
          )
        ).stdout,
      ),
    ).toBe('t');

    let completionFailure = '';
    const gateway: IntegrationDispatchGateway = {
      validateExecution: async (input) =>
        lastLine(
          (
            await asService(
              `select public.validate_integration_outbox_execution('${input.outboxJobId}','${input.leaseToken}',${input.leaseGeneration})`,
            )
          ).stdout,
        ) as Awaited<ReturnType<IntegrationDispatchGateway['validateExecution']>>,
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
    const queueExport = async (businessKey: string, previewKey: string) => {
      const issued = JSON.parse(
        lastLine(
          (
            await asActor(
              ids.owner,
              `select row_to_json(result) from public.issue_roster_export_source('${ids.organization}','${connected.connectionId}','${ids.roster}',${jsonSql(destination)},${textArraySql(approvedFields)}) result`,
            )
          ).stdout,
        ),
      ) as {
        source_id: string;
        source_digest: string;
        roster: Json;
        existing_athlete_ids: string[];
      };
      const providerPreview = rosterExportPreviewSchema.parse(
        await provider.previewRosterExport(
          {
            ...providerContext,
            correlationId: `correlation:${previewKey}`,
            idempotencyKey: previewKey,
          },
          {
            destination,
            approvedFields: [...approvedFields],
            roster: finalizedRosterSnapshotSchema.parse(issued.roster),
          },
        ),
      );
      const existing = new Set(issued.existing_athlete_ids);
      const nextPreview = {
        ...providerPreview,
        items: providerPreview.items.map((item) =>
          existing.has(item.registrationId) && item.operation === 'create'
            ? { ...item, operation: 'update' as const }
            : item,
        ),
      };
      expect(
        lastLine(
          (
            await asActor(
              ids.owner,
              `select public.save_roster_export_preview_v2('${ids.organization}','${issued.source_id}','${issued.source_digest}','${nextPreview.previewId}','${nextPreview.confirmationToken}',${jsonSql(nextPreview)})`,
            )
          ).stdout,
        ),
      ).toBe('created');
      return JSON.parse(
        lastLine(
          (
            await asActor(
              ids.owner,
              `select row_to_json(result) from public.confirm_roster_export_preview_v2('${ids.organization}','${nextPreview.previewId}','${nextPreview.confirmationToken}','${businessKey}') result`,
            )
          ).stdout,
        ),
      ) as { outcome: string; job_id: string };
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
            `select count(*) filter(where state='failed' and retry_eligible),count(*) filter(where state='completed' and retry_eligible) from public.integration_sync_items where sync_job_id='${first.job_id}'`,
          )
        ).stdout,
      ),
    ).toBe('1|0');
    expect(
      lastLine(
        (
          await psql(
            `select count(*) from public.external_entity_mappings where organization_id='${ids.organization}'`,
          )
        ).stdout,
      ),
    ).toBe('3');

    const retrySql = `select row_to_json(result) from public.retry_integration_sync_job_v2('${ids.organization}','${first.job_id}','retry:task27:00000001') result`;
    const retryResults = (
      await Promise.all([asActor(ids.owner, retrySql), asActor(ids.owner, retrySql)])
    ).map((output) => JSON.parse(lastLine(output.stdout))) as Array<{
      outcome: string;
      retried_item_count: number;
      preserved_completed_item_count: number;
    }>;
    const retry = retryResults.find((result) => result.outcome === 'queued')!;
    expect(retry).toMatchObject({
      outcome: 'queued',
      retried_item_count: 1,
      preserved_completed_item_count: 1,
    });
    expect(retryResults.find((result) => result.outcome === 'replayed')).toMatchObject({
      retried_item_count: 1,
      preserved_completed_item_count: 1,
    });
    const retryClaim = await claim();
    expect(retryClaim.itemKeys).toEqual([`athlete:${ids.registrationB}`]);
    const freshProvider = new MockTheSquadProvider({ fixture: 'partial-failure' });
    const freshExport = freshProvider.exportFinalizedRoster.bind(freshProvider);
    let retryTerminalResult: ReturnType<typeof syncJobResultSchema.parse> | undefined;
    freshProvider.exportFinalizedRoster = async (context, request) => {
      retryTerminalResult = syncJobResultSchema.parse(await freshExport(context, request));
      return retryTerminalResult;
    };
    expect(
      await dispatchIntegrationJob(retryClaim, {
        providers: { get: () => freshProvider },
        gateway,
      }),
    ).toBe('completed');
    expect(retryTerminalResult).toBeDefined();
    await expect(
      gateway.complete({
        outboxJobId: retryClaim.outboxJobId,
        leaseToken: retryClaim.leaseToken,
        leaseGeneration: retryClaim.leaseGeneration,
        externalJobId: retryTerminalResult!.externalJobId,
        result: retryTerminalResult!,
      }),
    ).resolves.toBe('replayed');
    await expect(
      gateway.complete({
        outboxJobId: retryClaim.outboxJobId,
        leaseToken: retryClaim.leaseToken,
        leaseGeneration: retryClaim.leaseGeneration,
        externalJobId: retryTerminalResult!.externalJobId,
        result: {
          ...retryTerminalResult!,
          entityMappings: [...(retryTerminalResult!.entityMappings ?? [])].reverse(),
        },
      }),
    ).resolves.toBe('terminal_conflict');
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
    ).toBe('4');
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
    const emptySource = JSON.parse(
      lastLine(
        (
          await asActor(
            ids.owner,
            `select row_to_json(result) from public.issue_roster_export_source('${ids.organization}','${connected.connectionId}','${emptyRoster}',${jsonSql(destination)},${textArraySql(approvedFields)}) result`,
          )
        ).stdout,
      ),
    ) as { outcome: string; source_id: string; source_digest: string; roster: Json };
    const emptySnapshot = finalizedRosterSnapshotSchema.parse(emptySource.roster);
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
            `select public.save_roster_export_preview_v2('${ids.organization}','${emptySource.source_id}','${emptySource.source_digest}','${emptyPreview.previewId}','${emptyPreview.confirmationToken}',${jsonSql(emptyPreview)})`,
          )
        ).stdout,
      ),
    ).toBe('created');
    const emptyConfirmation = JSON.parse(
      lastLine(
        (
          await asActor(
            ids.owner,
            `select row_to_json(result) from public.confirm_roster_export_preview_v2('${ids.organization}','${emptyPreview.previewId}','${emptyPreview.confirmationToken}','export:task27:empty:0001') result`,
          )
        ).stdout,
      ),
    ) as { outcome: string; job_id: string | null };
    expect(emptyConfirmation.outcome).toBe('completed');
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

    const uncertain = await queueExport(
      'export:task27:uncertain:0001',
      'preview:task27:uncertain:0001',
    );
    const uncertainClaim = await claim();
    const originalExport = provider.exportFinalizedRoster.bind(provider);
    let uncertainProviderCalls = 0;
    provider.exportFinalizedRoster = async (context, request) => {
      uncertainProviderCalls += 1;
      const result = await originalExport(context, request);
      await psql(
        `update public.integration_connections set state='disconnected',disconnected_at=clock_timestamp() where organization_id='${ids.organization}' and id='${connected.connectionId}'`,
      );
      return result;
    };
    expect(
      await dispatchIntegrationJob(uncertainClaim, { providers: { get: () => provider }, gateway }),
    ).toBe('needs_attention');
    expect(uncertainProviderCalls).toBe(1);
    expect(
      lastLine(
        (
          await psql(
            `select state from public.integration_sync_jobs where id='${uncertain.job_id}'`,
          )
        ).stdout,
      ),
    ).toBe('needs_attention');
    const unsafeRetry = JSON.parse(
      lastLine(
        (
          await asActor(
            ids.owner,
            `select row_to_json(result) from public.retry_integration_sync_job_v2('${ids.organization}','${uncertain.job_id}','retry:task27:uncertain:01') result`,
          )
        ).stdout,
      ),
    ) as { outcome: string };
    expect(unsafeRetry.outcome).toBe('manual_attention_required');

    provider.exportFinalizedRoster = originalExport;
    await psql(
      `update public.integration_connections set state='connected',disconnected_at=null where organization_id='${ids.organization}' and id='${connected.connectionId}'; update public.athletes set given_name='Changed before revoked source' where organization_id='${ids.organization}' and id='${ids.athleteA}'`,
    );

    const prepareRacingPreview = async (racingFields: readonly ('first_name' | 'last_name')[]) => {
      const issued = JSON.parse(
        lastLine(
          (
            await asActor(
              ids.owner,
              `select row_to_json(result) from public.issue_roster_export_source('${ids.organization}','${connected.connectionId}','${ids.roster}',${jsonSql(destination)},${textArraySql(racingFields)}) result`,
            )
          ).stdout,
        ),
      ) as {
        source_id: string;
        source_digest: string;
        roster: Json;
        existing_athlete_ids: string[];
      };
      const providerRacingPreview = rosterExportPreviewSchema.parse(
        await provider.previewRosterExport(providerContext, {
          destination,
          approvedFields: [...racingFields],
          roster: finalizedRosterSnapshotSchema.parse(issued.roster),
        }),
      );
      const existing = new Set(issued.existing_athlete_ids);
      const racingPreview = {
        ...providerRacingPreview,
        items: providerRacingPreview.items.map((item) =>
          existing.has(item.registrationId) && item.operation === 'create'
            ? { ...item, operation: 'update' as const }
            : item,
        ),
      };
      expect(
        lastLine(
          (
            await asActor(
              ids.owner,
              `select public.save_roster_export_preview_v2('${ids.organization}','${issued.source_id}','${issued.source_digest}','${racingPreview.previewId}','${racingPreview.confirmationToken}',${jsonSql(racingPreview)})`,
            )
          ).stdout,
        ),
      ).toBe('created');
      return racingPreview;
    };
    const [racingPreviewA, racingPreviewB] = await Promise.all([
      prepareRacingPreview(['first_name']),
      prepareRacingPreview(['last_name']),
    ]);
    const racingKey = 'export:task27:business-race:01';
    const racingResults = await Promise.all(
      [racingPreviewA, racingPreviewB].map((candidate) =>
        asActor(
          ids.owner,
          `select row_to_json(result) from public.confirm_roster_export_preview_v2('${ids.organization}','${candidate.previewId}','${candidate.confirmationToken}','${racingKey}') result`,
        ),
      ),
    );
    const racingOutcomes = racingResults.map(
      (output) => (JSON.parse(lastLine(output.stdout)) as { outcome: string }).outcome,
    );
    expect(racingOutcomes.sort()).toEqual(['conflict', 'queued']);
    expect(
      await dispatchIntegrationJob(await claim(), { providers: { get: () => provider }, gateway }),
    ).toBe('completed');

    await psql(
      `update public.athletes set given_name='Stale handoff lease' where organization_id='${ids.organization}' and id='${ids.athleteA}'`,
    );
    const staleHandoff = await queueExport(
      'export:task27:stale-handoff:01',
      'preview:task27:stale-handoff:01',
    );
    const staleHandoffClaim = await claim();
    await expect(gateway.authorize(staleHandoffClaim)).resolves.toBe('authorized');
    await psql(
      `update public.integration_outbox_jobs set lease_expires_at=clock_timestamp()-interval '1 second' where id='${staleHandoffClaim.outboxJobId}'`,
    );
    await expect(gateway.authorize(staleHandoffClaim)).resolves.toBe('delivery_uncertain');
    expect(
      lastLine(
        (
          await psql(
            `select state from public.integration_sync_jobs where id='${staleHandoff.job_id}'`,
          )
        ).stdout,
      ),
    ).toBe('needs_attention');

    await psql(
      `update public.athletes set given_name='Failure lease edge' where organization_id='${ids.organization}' and id='${ids.athleteA}'`,
    );
    await queueExport('export:task27:failure-edge:01', 'preview:task27:failure-edge:01');
    const failureEdgeClaim = await claim();
    await expect(gateway.authorize(failureEdgeClaim)).resolves.toBe('authorized');
    await psql(
      `update public.integration_outbox_jobs set lease_expires_at=clock_timestamp()+interval '200 milliseconds' where id='${failureEdgeClaim.outboxJobId}'`,
    );
    const heldFailureRow = psql(
      `begin; select id from public.integration_outbox_jobs where id='${failureEdgeClaim.outboxJobId}' for update; select pg_sleep(0.3); commit`,
    );
    await new Promise<void>((resolve) => setTimeout(resolve, 40));
    const failureAtLeaseEdge = gateway.fail({
      outboxJobId: failureEdgeClaim.outboxJobId,
      leaseToken: failureEdgeClaim.leaseToken,
      leaseGeneration: failureEdgeClaim.leaseGeneration,
      errorCode: 'provider_temporary',
      retryable: true,
    });
    await heldFailureRow;
    await expect(failureAtLeaseEdge).resolves.toBe('needs_attention');

    await psql(
      `update public.athletes set given_name='Exhausted claim' where organization_id='${ids.organization}' and id='${ids.athleteA}'`,
    );
    await queueExport('export:task27:exhausted:0001', 'preview:task27:exhausted:0001');
    const exhaustedClaim = await claim();
    await psql(
      `update public.integration_outbox_jobs set lease_expires_at=clock_timestamp()-interval '1 second',max_attempts=attempt_count where id='${exhaustedClaim.outboxJobId}';
       update public.athletes set given_name='Healthy behind exhausted' where organization_id='${ids.organization}' and id='${ids.athleteA}'`,
    );
    await queueExport('export:task27:healthy-behind:01', 'preview:task27:healthy-behind:01');
    const healthyBehind = await claim();
    expect(healthyBehind.outboxJobId).not.toBe(exhaustedClaim.outboxJobId);
    expect(
      lastLine(
        (
          await psql(
            `select status||'|'||(attempt_count<=max_attempts)::text from public.integration_outbox_jobs where id='${exhaustedClaim.outboxJobId}'`,
          )
        ).stdout,
      ),
    ).toBe('dead_letter|true');
    await psql(
      `update public.integration_outbox_jobs set status='cancelled',cancelled_at=clock_timestamp(),lease_owner=null,lease_token=null,lease_expires_at=null where id='${healthyBehind.outboxJobId}';
       update public.integration_sync_jobs set state='cancelled',cancelled_at=clock_timestamp() where id='${healthyBehind.syncJobId}';
       update public.integration_sync_items set state='cancelled',normalized_error='{"code":"test_cleanup","retryable":false}' where sync_job_id='${healthyBehind.syncJobId}' and state not in ('completed','skipped')`,
    );

    const retentionSources = await Promise.all([
      issueAdditionalSource(),
      issueAdditionalSource(),
      issueAdditionalSource(),
    ]);
    await psql(
      `update public.integration_export_previews set created_at=clock_timestamp()-interval '8 days',expires_at=clock_timestamp()-interval '1 day' where id in (${retentionSources.map((item) => `'${item.source_id}'`).join(',')})`,
    );
    expect(
      lastLine((await asService(`select public.purge_expired_integration_previews(2)`)).stdout),
    ).toBe('2');
    expect(
      lastLine(
        (
          await psql(
            `select count(*) from public.integration_export_previews where id in (${retentionSources.map((item) => `'${item.source_id}'`).join(',')})`,
          )
        ).stdout,
      ),
    ).toBe('1');
    await asService(`select public.purge_expired_integration_previews(10)`);
    await psql(
      `update public.athletes set given_name='Active retention lease' where organization_id='${ids.organization}' and id='${ids.athleteA}'`,
    );
    const activeRetention = await queueExport(
      'export:task27:active-retain:01',
      'preview:task27:active-retain:01',
    );
    const activeRetentionClaim = await claim();
    const activeSourceId = lastLine(
      (
        await psql(
          `select source_preview_id from public.integration_sync_jobs where id='${activeRetention.job_id}'`,
        )
      ).stdout,
    );
    await psql(
      `update public.integration_export_previews set created_at=clock_timestamp()-interval '8 days',expires_at=clock_timestamp()-interval '1 day' where id='${activeSourceId}'`,
    );
    expect(
      lastLine((await asService(`select public.purge_expired_integration_previews(1)`)).stdout),
    ).toBe('0');
    expect(
      lastLine(
        (
          await psql(
            `select stage from public.integration_export_previews where id='${activeSourceId}'`,
          )
        ).stdout,
      ),
    ).toBe('ready');
    await expect(gateway.authorize(activeRetentionClaim)).resolves.toBe('authorization_revoked');

    await psql(
      `update public.athletes set given_name='Mapping race one' where organization_id='${ids.organization}' and id='${ids.athleteA}'`,
    );
    await queueExport('export:task27:mapping-race:01', 'preview:task27:mapping-race:01');
    const mappingClaimA = await claim();
    await psql(
      `update public.athletes set given_name='Mapping race two' where organization_id='${ids.organization}' and id='${ids.athleteA}'`,
    );
    await queueExport('export:task27:mapping-race:02', 'preview:task27:mapping-race:02');
    const mappingClaimB = await claim();
    const prepareMappingCompletion = async (candidate: typeof mappingClaimA) => {
      await gateway.validateExecution(candidate);
      await gateway.authorize(candidate);
      return syncJobResultSchema.parse(
        await provider.exportFinalizedRoster(
          {
            organizationId: candidate.organizationId,
            actorId: candidate.actorUserId,
            connectionId: candidate.connectionId,
            correlationId: `integration:${candidate.syncJobId}`,
            idempotencyKey: candidate.providerIdempotencyKey,
          },
          candidate.confirmedRequest,
        ),
      );
    };
    const [mappingResultA, mappingResultB] = await Promise.all([
      prepareMappingCompletion(mappingClaimA),
      prepareMappingCompletion(mappingClaimB),
    ]);
    const reversedMappingResult = {
      ...mappingResultB,
      items: [...mappingResultB.items].reverse(),
      entityMappings: [...(mappingResultB.entityMappings ?? [])].reverse(),
    };
    await expect(
      Promise.all([
        gateway.complete({
          outboxJobId: mappingClaimA.outboxJobId,
          leaseToken: mappingClaimA.leaseToken,
          leaseGeneration: mappingClaimA.leaseGeneration,
          externalJobId: mappingResultA.externalJobId,
          result: mappingResultA,
        }),
        gateway.complete({
          outboxJobId: mappingClaimB.outboxJobId,
          leaseToken: mappingClaimB.leaseToken,
          leaseGeneration: mappingClaimB.leaseGeneration,
          externalJobId: reversedMappingResult.externalJobId,
          result: reversedMappingResult,
        }),
      ]),
    ).resolves.toEqual(['completed', 'completed']);

    const delay = (milliseconds: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
    const raceKinds = ['membership', 'connection', 'source'] as const;
    for (const kind of raceKinds) {
      for (const authorizationFirst of [true, false]) {
        const raceLabel = `${kind}-${authorizationFirst ? 'auth' : 'revoke'}`;
        await psql(
          `update public.organization_members set status='active' where organization_id='${ids.organization}' and user_id='${ids.owner}';
           update public.integration_connections set state='connected',disconnected_at=null where organization_id='${ids.organization}' and id='${connected.connectionId}';
           update public.athletes set given_name='Race ${raceLabel}' where organization_id='${ids.organization}' and id='${ids.athleteA}'`,
        );
        const raceJob = await queueExport(
          `export:task27:lock:${raceLabel}`,
          `preview:task27:lock:${raceLabel}`,
        );
        const raceClaim = await claim();
        const sourceId = lastLine(
          (
            await psql(
              `select source_preview_id from public.integration_sync_jobs where id='${raceJob.job_id}'`,
            )
          ).stdout,
        );
        const invalidate =
          kind === 'membership'
            ? `update public.organization_members set status='disabled' where organization_id='${ids.organization}' and user_id='${ids.owner}'`
            : kind === 'connection'
              ? `update public.integration_connections set state='disconnected',disconnected_at=clock_timestamp() where organization_id='${ids.organization}' and id='${connected.connectionId}'`
              : `update public.integration_export_previews set expires_at=created_at+interval '1 microsecond' where id='${sourceId}'`;
        const authorizeSql = `begin; set role service_role; select set_config('request.jwt.claim.role','service_role',false); select public.authorize_integration_outbox_submission('${raceClaim.outboxJobId}','${raceClaim.leaseToken}',${raceClaim.leaseGeneration}); select pg_sleep(0.25); commit`;
        const invalidateSql = `begin; ${invalidate}; select pg_sleep(0.25); commit`;
        if (authorizationFirst) {
          const authorizePromise = psql(authorizeSql);
          await delay(40);
          const startedAt = performance.now();
          const invalidationPromise = psql(invalidateSql);
          await Promise.all([authorizePromise, invalidationPromise]);
          expect(performance.now() - startedAt).toBeGreaterThan(150);
          expect(
            lastLine(
              (
                await psql(
                  `select provider_submission_started_at is not null from public.integration_outbox_jobs where id='${raceClaim.outboxJobId}'`,
                )
              ).stdout,
            ),
          ).toBe('t');
          expect(
            lastLine(
              (
                await asService(
                  `select public.authorize_integration_outbox_submission('${raceClaim.outboxJobId}','${raceClaim.leaseToken}',${raceClaim.leaseGeneration})`,
                )
              ).stdout,
            ),
          ).toBe('delivery_uncertain');
        } else {
          const invalidationPromise = psql(invalidateSql);
          await delay(40);
          const startedAt = performance.now();
          const authorizePromise = asService(
            `select public.authorize_integration_outbox_submission('${raceClaim.outboxJobId}','${raceClaim.leaseToken}',${raceClaim.leaseGeneration})`,
          );
          await invalidationPromise;
          expect(lastLine((await authorizePromise).stdout)).toBe('authorization_revoked');
          expect(performance.now() - startedAt).toBeGreaterThan(150);
          expect(
            lastLine(
              (
                await psql(
                  `select provider_submission_started_at is null from public.integration_outbox_jobs where id='${raceClaim.outboxJobId}'`,
                )
              ).stdout,
            ),
          ).toBe('t');
        }
      }
    }

    await psql(
      `update public.athletes set given_name='Revoked source final' where organization_id='${ids.organization}' and id='${ids.athleteA}'`,
    );
    const revoked = await queueExport(
      'export:task27:revoked:000001',
      'preview:task27:revoked:000001',
    );
    const revokedClaim = await claim();
    await psql(
      `update public.organization_members set status='disabled' where organization_id='${ids.organization}' and user_id='${ids.owner}'`,
    );
    const revokedProvider = new MockTheSquadProvider({ fixture: 'success' });
    const revokedOriginal = revokedProvider.exportFinalizedRoster.bind(revokedProvider);
    let revokedProviderCalls = 0;
    revokedProvider.exportFinalizedRoster = async (context, request) => {
      revokedProviderCalls += 1;
      return revokedOriginal(context, request);
    };
    expect(
      await dispatchIntegrationJob(revokedClaim, {
        providers: { get: () => revokedProvider },
        gateway,
      }),
    ).toBe('cancelled');
    expect(revokedProviderCalls).toBe(0);
    expect(
      lastLine(
        (await psql(`select state from public.integration_sync_jobs where id='${revoked.job_id}'`))
          .stdout,
      ),
    ).toBe('cancelled');
  }, 30_000);
});
