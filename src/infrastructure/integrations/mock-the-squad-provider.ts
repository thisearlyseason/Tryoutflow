import 'server-only';

import { createHash } from 'node:crypto';

import { z } from 'zod';

import partialFailureFixtureJson from '../../../tests/fixtures/integrations/the-squad/partial-failure.json';
import successFixtureJson from '../../../tests/fixtures/integrations/the-squad/success.json';
import {
  athleteImportPreviewItemSchema,
  athleteImportPreviewSchema,
  athleteImportRequestSchema,
  confirmedAthleteImportSchema,
  confirmedRosterExportSchema,
  connectionCallbackSchema,
  connectionChallengeSchema,
  connectionHealthSchema,
  connectionRequestSchema,
  connectionResultSchema,
  externalEntityRefSchema,
  externalOrganizationListSchema,
  externalOrganizationSchema,
  externalRosterDestinationListSchema,
  finalizedRosterExportRequestSchema,
  providerContextSchema,
  rosterExportPreviewSchema,
  syncJobResultSchema,
  type ConfirmedAthleteImport,
  type ConfirmedRosterExport,
  type ExternalEntityRef,
  type FinalizedRosterExportRequest,
  type ProviderContext,
  type SyncJobResult,
  type TeamManagementProviderError,
} from '../../modules/integrations/domain/contracts';
import type { TeamManagementProvider } from '../../modules/integrations/domain/provider';

const FIXTURE_TIME = '2026-08-29T18:30:00.000Z';
const fixtureSchema = z.strictObject({
  fixtureLabel: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .refine((value) => /mock|synthetic/iu.test(value), 'fixture must be labeled as mock data'),
  organization: externalOrganizationSchema.extend({
    providerKey: z.literal('the-squad'),
    mockData: z.literal(true),
  }),
  destination: z.unknown(),
  importCandidates: z.array(athleteImportPreviewItemSchema).max(5_000),
  exportExternalIds: z.record(z.uuid(), z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/u)),
  failOnceRegistrationIds: z.array(z.uuid()).max(5_000),
});

type Fixture = Omit<z.infer<typeof fixtureSchema>, 'destination'> & {
  destination: z.infer<(typeof externalRosterDestinationListSchema)['element']>;
};

type StoredJob = {
  digest: string;
  result: SyncJobResult;
};

export type MockTheSquadProviderOptions = Readonly<{
  fixture: 'success' | 'partial-failure';
}>;

export class MockTheSquadProvider implements TeamManagementProvider {
  readonly providerKey = 'the-squad';

  private readonly fixture: Fixture;
  private readonly challenges = new Map<string, { organizationId: string; actorId: string }>();
  private readonly jobsById = new Map<string, StoredJob>();
  private readonly jobsByIdempotencyKey = new Map<string, string>();
  private readonly completedExportRegistrations = new Map<string, ExternalEntityRef>();
  private readonly failedOnce = new Set<string>();
  private readonly disconnectedConnectionIds = new Set<string>();

  constructor(options: MockTheSquadProviderOptions) {
    const raw = options.fixture === 'success' ? successFixtureJson : partialFailureFixtureJson;
    const fixtureBase = parseConfiguration(fixtureSchema, raw);
    const destination = parseConfiguration(externalRosterDestinationListSchema, [
      fixtureBase.destination,
    ])[0]!;
    this.fixture = { ...fixtureBase, destination };
  }

  async beginConnection(input: Parameters<TeamManagementProvider['beginConnection']>[0]) {
    const parsed = parseInput(connectionRequestSchema, input);
    const challengeId = stableToken('mock-challenge', parsed);
    this.challenges.set(challengeId, {
      organizationId: parsed.organizationId,
      actorId: parsed.actorId,
    });
    return immutableClone(
      parseOutput(connectionChallengeSchema, {
        mode: 'mock',
        challengeId,
        expiresAt: '2099-01-01T00:00:00.000Z',
        displayLabel: 'The Squad (demo/mock — no live transfer)',
        mockData: true,
      }),
    );
  }

  async completeConnection(input: Parameters<TeamManagementProvider['completeConnection']>[0]) {
    const parsed = parseInput(connectionCallbackSchema, input);
    if (
      this.challenges.get(parsed.challengeId)?.organizationId !== parsed.organizationId ||
      this.challenges.get(parsed.challengeId)?.actorId !== parsed.actorId ||
      parsed.callbackParameters.mockApproval !== 'approved'
    ) {
      throw providerError('connection_invalid');
    }
    this.disconnectedConnectionIds.delete(stableUuid('mock-connection', parsed.organizationId));
    return immutableClone(
      parseOutput(connectionResultSchema, {
        connectionId: stableUuid('mock-connection', parsed.organizationId),
        providerKey: this.providerKey,
        state: 'connected',
        displayName: 'The Squad (demo/mock)',
        connectedAt: FIXTURE_TIME,
        mockData: true,
      }),
    );
  }

  async verifyConnection(context: ProviderContext) {
    this.parseConnectedContext(context);
    return immutableClone(
      parseOutput(connectionHealthSchema, {
        state: 'healthy',
        checkedAt: FIXTURE_TIME,
        mockData: true,
      }),
    );
  }

  async disconnect(context: ProviderContext) {
    const parsed = parseInput(providerContextSchema, context);
    this.disconnectedConnectionIds.add(parsed.connectionId);
  }

  async listOrganizations(context: ProviderContext) {
    this.parseConnectedContext(context);
    return immutableClone(parseOutput(externalOrganizationListSchema, [this.fixture.organization]));
  }

  async listDestinations(context: ProviderContext, organization: ExternalEntityRef) {
    this.parseConnectedContext(context);
    const parsed = parseInput(externalEntityRefSchema, organization);
    if (
      parsed.entityType !== 'organization' ||
      parsed.providerKey !== this.providerKey ||
      parsed.externalId !== this.fixture.organization.externalId
    ) {
      throw providerError('not_found');
    }
    return immutableClone(
      parseOutput(externalRosterDestinationListSchema, [this.fixture.destination]),
    );
  }

  async previewAthleteImport(
    context: ProviderContext,
    request: Parameters<TeamManagementProvider['previewAthleteImport']>[1],
  ) {
    this.parseConnectedContext(context);
    const parsed = parseInput(athleteImportRequestSchema, request);
    this.assertSourceOrganization(parsed.sourceOrganization);
    const previewId = stableToken('mock-import-preview', parsed);
    const items = this.importCandidatesFor(parsed.approvedFields);
    return immutableClone(
      parseOutput(athleteImportPreviewSchema, {
        previewId,
        confirmationToken: stableToken('mock-import-confirmation', { previewId, parsed }),
        items,
        mockData: true,
      }),
    );
  }

  async importAthletes(context: ProviderContext, request: ConfirmedAthleteImport) {
    this.parseConnectedContext(context);
    const parsed = parseInput(confirmedAthleteImportSchema, request);
    this.assertSourceOrganization(parsed.sourceOrganization);
    const previewRequest = {
      sourceOrganization: parsed.sourceOrganization,
      approvedFields: parsed.approvedFields,
    };
    const expectedPreviewId = stableToken('mock-import-preview', previewRequest);
    const expectedConfirmation = stableToken('mock-import-confirmation', {
      previewId: expectedPreviewId,
      parsed: previewRequest,
    });
    if (
      parsed.previewId !== expectedPreviewId ||
      parsed.confirmationToken !== expectedConfirmation ||
      digest(parsed.items) !== digest(this.importCandidatesFor(parsed.approvedFields))
    ) {
      throw providerError('conflict');
    }

    const handoffDigest = digest(parsed);
    const existing = this.existingJob(context.idempotencyKey, handoffDigest);
    if (existing) return existing;
    const externalJobId = stableExternalId('mock-import-job', context.idempotencyKey);
    const items = parsed.items.map((item) => ({
      itemKey: `athlete:${item.externalAthlete.externalId}`,
      entityType: 'athlete' as const,
      state:
        item.disposition === 'duplicate'
          ? ('skipped' as const)
          : item.disposition === 'requires_review'
            ? ('requires_review' as const)
            : ('completed' as const),
      attempts: 1,
      externalRef: item.disposition === 'requires_review' ? null : item.externalAthlete,
      error: item.disposition === 'requires_review' ? providerError('conflict') : null,
    }));
    const completedItems = items.filter((item) =>
      ['completed', 'skipped'].includes(item.state),
    ).length;
    const result = parseOutput(syncJobResultSchema, {
      externalJobId,
      state:
        completedItems === items.length
          ? 'completed'
          : completedItems === 0
            ? 'failed'
            : 'partially_completed',
      items,
      mockData: true,
    });
    this.storeJob(context.idempotencyKey, handoffDigest, result);
    return immutableClone(result);
  }

  async previewRosterExport(context: ProviderContext, request: FinalizedRosterExportRequest) {
    this.parseConnectedContext(context);
    const parsed = parseInput(finalizedRosterExportRequestSchema, request);
    this.assertDestination(parsed.destination);
    this.assertOrganization(context, parsed.roster.organizationId);
    const snapshotDigest = digest(parsed);
    const previewId = stableToken('mock-export-preview', snapshotDigest);
    const result = parseOutput(rosterExportPreviewSchema, {
      previewId,
      confirmationToken: stableToken('mock-export-confirmation', { previewId, snapshotDigest }),
      snapshotDigest,
      totalItems: parsed.roster.athletes.length,
      items: parsed.roster.athletes.map((athlete) => ({
        itemKey: `athlete:${athlete.registrationId}`,
        registrationId: athlete.registrationId,
        operation: this.completedExportRegistrations.has(athlete.registrationId)
          ? 'update'
          : this.fixture.exportExternalIds[athlete.registrationId]
            ? 'create'
            : 'requires_review',
        displayLabel: `${athlete.firstName} ${athlete.lastName}`,
      })),
      mockData: true,
    });
    return immutableClone(result);
  }

  async exportFinalizedRoster(context: ProviderContext, request: ConfirmedRosterExport) {
    this.parseConnectedContext(context);
    const parsed = parseInput(confirmedRosterExportSchema, request);
    this.assertDestination(parsed.destination);
    this.assertOrganization(context, parsed.roster.organizationId);
    const previewRequest = {
      destination: parsed.destination,
      approvedFields: parsed.approvedFields,
      roster: parsed.roster,
    };
    const snapshotDigest = digest(previewRequest);
    const expectedPreviewId = stableToken('mock-export-preview', snapshotDigest);
    const expectedConfirmation = stableToken('mock-export-confirmation', {
      previewId: expectedPreviewId,
      snapshotDigest,
    });
    if (
      parsed.previewId !== expectedPreviewId ||
      parsed.confirmationToken !== expectedConfirmation
    ) {
      throw providerError('conflict');
    }

    const handoffDigest = digest(parsed);
    const priorJobId = this.jobsByIdempotencyKey.get(context.idempotencyKey);
    if (priorJobId) {
      const prior = this.jobsById.get(priorJobId);
      if (!prior || prior.digest !== handoffDigest) throw providerError('conflict');
      if (prior.result.state === 'completed') return immutableClone(prior.result);
    }

    const externalJobId = priorJobId ?? stableExternalId('mock-export-job', context.idempotencyKey);
    const priorItems = new Map(
      (priorJobId ? this.jobsById.get(priorJobId)?.result.items : [])?.map((item) => [
        item.itemKey,
        item,
      ]),
    );
    const newlyFailedRegistrationIds: string[] = [];
    const completedMappings: { registrationId: string; externalRef: ExternalEntityRef }[] = [];
    const items = parsed.roster.athletes.map((athlete) => {
      const itemKey = `athlete:${athlete.registrationId}`;
      const prior = priorItems.get(itemKey);
      if (prior?.state === 'completed') return prior;
      const attempts = (prior?.attempts ?? 0) + 1;
      const externalId = this.fixture.exportExternalIds[athlete.registrationId];
      if (!externalId) {
        return {
          itemKey,
          entityType: 'athlete' as const,
          state: 'requires_review' as const,
          attempts,
          externalRef: null,
          error: providerError('not_found'),
        };
      }
      if (
        this.fixture.failOnceRegistrationIds.includes(athlete.registrationId) &&
        !this.failedOnce.has(`${context.idempotencyKey}:${athlete.registrationId}`)
      ) {
        newlyFailedRegistrationIds.push(athlete.registrationId);
        return {
          itemKey,
          entityType: 'athlete' as const,
          state: 'failed' as const,
          attempts,
          externalRef: null,
          error: providerError('provider_temporary'),
        };
      }
      const externalRef = parseOutput(externalEntityRefSchema, {
        providerKey: this.providerKey,
        entityType: 'athlete',
        externalId,
        displayName: `${athlete.firstName} ${athlete.lastName}`,
        mockData: true,
      });
      completedMappings.push({ registrationId: athlete.registrationId, externalRef });
      return {
        itemKey,
        entityType: 'athlete' as const,
        state: 'completed' as const,
        attempts,
        externalRef,
        error: null,
      };
    });
    const completed = items.filter((item) => item.state === 'completed').length;
    const state =
      completed === items.length ? 'completed' : completed === 0 ? 'failed' : 'partially_completed';
    const result = parseOutput(syncJobResultSchema, {
      externalJobId,
      state,
      items,
      mockData: true,
    });
    for (const registrationId of newlyFailedRegistrationIds) {
      this.failedOnce.add(`${context.idempotencyKey}:${registrationId}`);
    }
    for (const mapping of completedMappings) {
      this.completedExportRegistrations.set(mapping.registrationId, mapping.externalRef);
    }
    this.storeJob(context.idempotencyKey, handoffDigest, result);
    return immutableClone(result);
  }

  async getSyncStatus(context: ProviderContext, externalJobId: string) {
    this.parseConnectedContext(context);
    const parsedJobId = parseInput(
      z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/u),
      externalJobId,
    );
    const stored = this.jobsById.get(parsedJobId);
    if (!stored) throw providerError('not_found');
    return immutableClone(parseOutput(syncJobResultSchema, stored.result));
  }

  private parseConnectedContext(context: ProviderContext) {
    const parsed = parseInput(providerContextSchema, context);
    if (this.disconnectedConnectionIds.has(parsed.connectionId)) {
      throw providerError('authentication_required');
    }
    return parsed;
  }

  private assertOrganization(context: ProviderContext, organizationId: string) {
    if (context.organizationId !== organizationId) throw providerError('permission_denied');
  }

  private assertSourceOrganization(organization: ExternalEntityRef) {
    if (
      organization.providerKey !== this.providerKey ||
      organization.entityType !== 'organization' ||
      organization.externalId !== this.fixture.organization.externalId
    ) {
      throw providerError('not_found');
    }
  }

  private assertDestination(destination: Fixture['destination']) {
    if (digest(destination) !== digest(this.fixture.destination)) throw providerError('not_found');
  }

  private importCandidatesFor(approvedFields: readonly string[]) {
    const approved = new Set(approvedFields);
    return this.fixture.importCandidates.map((candidate) => ({
      externalAthlete: candidate.externalAthlete,
      disposition: candidate.disposition,
      fields: {
        firstName: candidate.fields.firstName,
        lastName: candidate.fields.lastName,
        ...(approved.has('email') && candidate.fields.email
          ? { email: candidate.fields.email }
          : {}),
        ...(approved.has('phone') && candidate.fields.phone
          ? { phone: candidate.fields.phone }
          : {}),
        ...(approved.has('birth_year') && candidate.fields.birthYear
          ? { birthYear: candidate.fields.birthYear }
          : {}),
        ...(approved.has('position') && candidate.fields.position
          ? { position: candidate.fields.position }
          : {}),
      },
    }));
  }

  private existingJob(idempotencyKey: string, handoffDigest: string) {
    const jobId = this.jobsByIdempotencyKey.get(idempotencyKey);
    if (!jobId) return null;
    const stored = this.jobsById.get(jobId);
    if (!stored || stored.digest !== handoffDigest) throw providerError('conflict');
    return immutableClone(stored.result);
  }

  private storeJob(idempotencyKey: string, handoffDigest: string, result: SyncJobResult) {
    const stored = structuredClone(result);
    this.jobsById.set(result.externalJobId, { digest: handoffDigest, result: stored });
    this.jobsByIdempotencyKey.set(idempotencyKey, result.externalJobId);
  }
}

function providerError(code: TeamManagementProviderError['code']): TeamManagementProviderError {
  return {
    code,
    retryable: ['rate_limited', 'provider_temporary', 'timeout'].includes(code),
  };
}

function digest(value: unknown) {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(value)))
    .digest('hex');
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter((entry) => entry[1] !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, nested]) => [key, canonicalize(nested)]),
  );
}

function stableToken(namespace: string, value: unknown) {
  return `${namespace}-${digest(value).slice(0, 32)}`;
}

function stableExternalId(namespace: string, value: unknown) {
  return `${namespace}-${digest(value).slice(0, 24)}`;
}

function stableUuid(namespace: string, value: unknown) {
  const bytes = Buffer.from(digest([namespace, value]).slice(0, 32), 'hex');
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function parseInput<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw providerError('invalid_request');
  return parsed.data;
}

function parseOutput<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw providerError('provider_configuration');
  return parsed.data;
}

function parseConfiguration<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw providerError('provider_configuration');
  return parsed.data;
}

function immutableClone<T>(value: T): T {
  return deepFreeze(structuredClone(value));
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}
