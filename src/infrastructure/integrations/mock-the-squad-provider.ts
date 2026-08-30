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
  providerSyncStatusSchema,
  rosterExportPreviewSchema,
  syncJobResultSchema,
  type ConfirmedAthleteImport,
  type ConfirmedRosterExport,
  type ExternalEntityRef,
  type FinalizedRosterExportRequest,
  type ProviderContext,
  type ProviderSyncStatus,
  type RosterExportProjectedFields,
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

const syncStatusTransitionsSchema = z
  .array(z.enum(['pending', 'processing']))
  .max(2)
  .superRefine((transitions, context) => {
    const rank = { pending: 0, processing: 1 } as const;
    transitions.forEach((transition, index) => {
      const previous = transitions[index - 1];
      if (previous !== undefined && rank[transition] <= rank[previous]) {
        context.addIssue({
          code: 'custom',
          message: 'sync status transitions must be strictly monotonic',
          path: [index],
        });
      }
    });
  });

type Fixture = Omit<z.infer<typeof fixtureSchema>, 'destination'> & {
  destination: z.infer<(typeof externalRosterDestinationListSchema)['element']>;
};

type StoredJob = {
  digest: string;
  result: SyncJobResult;
};

type ConnectionRecord = {
  providerKey: 'the-squad';
  connectionId: string;
  organizationId: string;
  creatorActorId: string;
  connected: boolean;
};

export type MockTheSquadProviderOptions = Readonly<{
  fixture: 'success' | 'partial-failure';
  syncStatusTransitions?: readonly ('pending' | 'processing')[];
}>;

export class MockTheSquadProvider implements TeamManagementProvider {
  readonly providerKey = 'the-squad';

  private readonly fixture: Fixture;
  private readonly syncStatusTransitions: readonly ('pending' | 'processing')[];
  private readonly challenges = new Map<string, { organizationId: string; actorId: string }>();
  private readonly connections = new Map<string, ConnectionRecord>();
  private readonly jobsById = new Map<string, StoredJob>();
  private readonly jobsByIdempotencyKey = new Map<string, string>();
  private readonly completedExportRegistrations = new Map<
    string,
    { externalRef: ExternalEntityRef; fields: RosterExportProjectedFields }
  >();
  private readonly failedOnce = new Set<string>();
  private readonly statusTransitionsByJob = new Map<string, ('pending' | 'processing')[]>();
  private challengeSequence = 0;

  constructor(options: MockTheSquadProviderOptions) {
    const raw = options.fixture === 'success' ? successFixtureJson : partialFailureFixtureJson;
    const fixtureBase = parseConfiguration(fixtureSchema, raw);
    const destination = parseConfiguration(externalRosterDestinationListSchema, [
      fixtureBase.destination,
    ])[0]!;
    this.fixture = { ...fixtureBase, destination };
    this.syncStatusTransitions = parseConfiguration(
      syncStatusTransitionsSchema,
      options.syncStatusTransitions ?? [],
    );
  }

  async beginConnection(input: Parameters<TeamManagementProvider['beginConnection']>[0]) {
    const parsed = parseInput(connectionRequestSchema, input);
    this.challengeSequence += 1;
    const challengeId = stableToken('mock-challenge', {
      request: parsed,
      issuance: this.challengeSequence,
    });
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
    const challenge = this.challenges.get(parsed.challengeId);
    if (
      challenge?.organizationId !== parsed.organizationId ||
      challenge.actorId !== parsed.actorId
    ) {
      throw providerError('connection_invalid');
    }
    // The exact scoped callback owns this one-time challenge from this point forward.
    // Consume before interpreting the provider result so denial and concurrent replay
    // cannot leave reusable authorization state behind.
    this.challenges.delete(parsed.challengeId);
    if (parsed.callbackParameters.mockApproval !== 'approved') {
      throw providerError('connection_invalid');
    }
    const connectionId = stableUuid('mock-connection', [
      this.providerKey,
      parsed.organizationId,
      parsed.actorId,
    ]);
    this.connections.set(connectionId, {
      providerKey: this.providerKey,
      connectionId,
      organizationId: parsed.organizationId,
      creatorActorId: parsed.actorId,
      connected: true,
    });
    return immutableClone(
      parseOutput(connectionResultSchema, {
        connectionId,
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
    const parsed = this.parseConnectedContext(context);
    const connection = this.connections.get(parsed.connectionId)!;
    this.connections.set(parsed.connectionId, { ...connection, connected: false });
    this.revokeChallenges(connection.organizationId, connection.creatorActorId);
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
    const parsedContext = this.parseConnectedContext(context);
    const parsed = parseInput(athleteImportRequestSchema, request);
    this.assertSourceOrganization(parsed.sourceOrganization);
    const previewId = stableToken('mock-import-preview', {
      scope: this.contextScope(parsedContext),
      previewRequest: parsed,
    });
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
    const parsedContext = this.parseConnectedContext(context);
    const parsed = parseInput(confirmedAthleteImportSchema, request);
    this.assertSourceOrganization(parsed.sourceOrganization);
    const previewRequest = {
      sourceOrganization: parsed.sourceOrganization,
      approvedFields: parsed.approvedFields,
    };
    const scope = this.contextScope(parsedContext);
    const expectedPreviewId = stableToken('mock-import-preview', { scope, previewRequest });
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
    const existing = this.existingJob(parsedContext, 'import', handoffDigest);
    if (existing) return existing;
    const externalJobId = stableExternalId('mock-import-job', [
      scope,
      parsedContext.idempotencyKey,
    ]);
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
    this.storeJob(parsedContext, 'import', handoffDigest, result);
    return immutableClone(result);
  }

  async previewRosterExport(context: ProviderContext, request: FinalizedRosterExportRequest) {
    const parsedContext = this.parseConnectedContext(context);
    const parsed = parseInput(finalizedRosterExportRequestSchema, request);
    this.assertDestination(parsed.destination);
    this.assertOrganization(parsedContext, parsed.roster.organizationId);
    const scope = this.contextScope(parsedContext);
    const snapshotDigest = digest(parsed);
    const previewId = stableToken('mock-export-preview', { scope, snapshotDigest });
    const result = parseOutput(rosterExportPreviewSchema, {
      previewId,
      confirmationToken: stableToken('mock-export-confirmation', { previewId, snapshotDigest }),
      snapshotDigest,
      totalItems: parsed.roster.athletes.length,
      items: parsed.roster.athletes.map((athlete) => {
        const teamName = parsed.roster.teams.find((team) => team.id === athlete.teamId)!.name;
        return {
          itemKey: `athlete:${athlete.registrationId}`,
          registrationId: athlete.registrationId,
          operation: this.completedExportRegistrations.has(
            this.mappingKey(parsedContext, athlete.registrationId),
          )
            ? 'update'
            : this.fixture.exportExternalIds[athlete.registrationId]
              ? 'create'
              : 'requires_review',
          displayLabel: exportedAthleteLabel(athlete, parsed.approvedFields),
          fields: projectRosterFields(athlete, teamName, parsed.approvedFields),
        };
      }),
      mockData: true,
    });
    return immutableClone(result);
  }

  async exportFinalizedRoster(context: ProviderContext, request: ConfirmedRosterExport) {
    const parsedContext = this.parseConnectedContext(context);
    const parsed = parseInput(confirmedRosterExportSchema, request);
    this.assertDestination(parsed.destination);
    this.assertOrganization(parsedContext, parsed.roster.organizationId);
    const scope = this.contextScope(parsedContext);
    const previewRequest = {
      destination: parsed.destination,
      approvedFields: parsed.approvedFields,
      roster: parsed.roster,
    };
    const snapshotDigest = digest(previewRequest);
    const expectedPreviewId = stableToken('mock-export-preview', { scope, snapshotDigest });
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
    const idempotencyScope = this.idempotencyScope(parsedContext, 'export');
    const priorJobId = this.jobsByIdempotencyKey.get(idempotencyScope);
    if (priorJobId) {
      const prior = this.jobsById.get(this.jobKey(parsedContext, priorJobId));
      if (!prior || prior.digest !== handoffDigest) throw providerError('conflict');
      if (prior.result.state === 'completed') return immutableClone(prior.result);
    }

    const externalJobId =
      priorJobId ?? stableExternalId('mock-export-job', [scope, parsedContext.idempotencyKey]);
    const priorItems = new Map(
      (priorJobId
        ? this.jobsById.get(this.jobKey(parsedContext, priorJobId))?.result.items
        : []
      )?.map((item) => [item.itemKey, item]),
    );
    const newlyFailedRegistrationIds: string[] = [];
    const completedMappings: {
      registrationId: string;
      externalRef: ExternalEntityRef;
      fields: RosterExportProjectedFields;
    }[] = [];
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
        (() => {
          const durableAttempt = /^integration:[0-9a-f-]{36}:([0-9]{1,3})$/u.exec(
            parsedContext.idempotencyKey,
          );
          return durableAttempt
            ? Number(durableAttempt[1]) === 1
            : !this.failedOnce.has(
                this.itemOperationKey(parsedContext, 'export-fail-once', athlete.registrationId),
              );
        })()
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
        externalId: stableExternalId('mock-athlete', [scope, externalId]),
        displayName: exportedAthleteLabel(athlete, parsed.approvedFields),
        mockData: true,
      });
      const teamName = parsed.roster.teams.find((team) => team.id === athlete.teamId)!.name;
      completedMappings.push({
        registrationId: athlete.registrationId,
        externalRef,
        fields: projectRosterFields(athlete, teamName, parsed.approvedFields),
      });
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
      entityMappings: [
        ...parsed.roster.teams.map((team) => ({
          entityType: 'team' as const,
          internalEntityId: team.id,
          externalRef: {
            providerKey: this.providerKey,
            entityType: 'team' as const,
            externalId: stableExternalId('mock-team', [scope, team.id]),
            displayName: parsed.approvedFields.includes('team_name')
              ? team.name
              : `Team ${team.id}`,
            mockData: true,
          },
        })),
        {
          entityType: 'roster_version' as const,
          internalEntityId: parsed.roster.rosterVersionId,
          externalRef: {
            providerKey: this.providerKey,
            entityType: 'roster_version' as const,
            externalId: stableExternalId('mock-roster-version', [
              scope,
              parsed.roster.rosterVersionId,
            ]),
            displayName: `Roster version ${parsed.roster.version}`,
            mockData: true,
          },
        },
      ],
      mockData: true,
    });
    for (const registrationId of newlyFailedRegistrationIds) {
      this.failedOnce.add(this.itemOperationKey(parsedContext, 'export-fail-once', registrationId));
    }
    for (const mapping of completedMappings) {
      this.completedExportRegistrations.set(
        this.mappingKey(parsedContext, mapping.registrationId),
        { externalRef: mapping.externalRef, fields: mapping.fields },
      );
    }
    this.storeJob(parsedContext, 'export', handoffDigest, result);
    return immutableClone(result);
  }

  async getSyncStatus(context: ProviderContext, externalJobId: string) {
    const parsedContext = this.parseConnectedContext(context);
    const parsedJobId = parseInput(
      z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/u),
      externalJobId,
    );
    const scopedJobKey = this.jobKey(parsedContext, parsedJobId);
    const stored = this.jobsById.get(scopedJobKey);
    if (!stored) throw providerError('not_found');
    const transitions = this.statusTransitionsByJob.get(scopedJobKey);
    const transition = transitions?.shift();
    if (transition) {
      return immutableClone(
        parseOutput(providerSyncStatusSchema, inFlightStatus(stored.result, transition)),
      );
    }
    return immutableClone(parseOutput(providerSyncStatusSchema, stored.result));
  }

  private parseConnectedContext(context: ProviderContext) {
    const parsed = parseInput(providerContextSchema, context);
    const connection = this.connections.get(parsed.connectionId);
    if (!connection || !connection.connected) {
      throw providerError('authentication_required');
    }
    if (
      connection.providerKey !== this.providerKey ||
      connection.connectionId !== parsed.connectionId ||
      connection.organizationId !== parsed.organizationId ||
      connection.creatorActorId !== parsed.actorId
    ) {
      throw providerError('permission_denied');
    }
    return parsed;
  }

  private revokeChallenges(organizationId: string, actorId: string) {
    for (const [challengeId, challenge] of this.challenges) {
      if (challenge.organizationId === organizationId && challenge.actorId === actorId) {
        this.challenges.delete(challengeId);
      }
    }
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

  private existingJob(
    context: ProviderContext,
    operation: 'import' | 'export',
    handoffDigest: string,
  ) {
    const jobId = this.jobsByIdempotencyKey.get(this.idempotencyScope(context, operation));
    if (!jobId) return null;
    const stored = this.jobsById.get(this.jobKey(context, jobId));
    if (!stored || stored.digest !== handoffDigest) throw providerError('conflict');
    return immutableClone(stored.result);
  }

  private storeJob(
    context: ProviderContext,
    operation: 'import' | 'export',
    handoffDigest: string,
    result: SyncJobResult,
  ) {
    const stored = structuredClone(result);
    const scopedJobKey = this.jobKey(context, result.externalJobId);
    this.jobsById.set(scopedJobKey, { digest: handoffDigest, result: stored });
    this.jobsByIdempotencyKey.set(this.idempotencyScope(context, operation), result.externalJobId);
    if (!this.statusTransitionsByJob.has(scopedJobKey) && this.syncStatusTransitions.length > 0) {
      this.statusTransitionsByJob.set(scopedJobKey, [...this.syncStatusTransitions]);
    }
  }

  private contextScope(context: ProviderContext) {
    return [this.providerKey, context.organizationId, context.connectionId, context.actorId].join(
      ':',
    );
  }

  private idempotencyScope(context: ProviderContext, operation: 'import' | 'export') {
    return `${this.contextScope(context)}:${operation}:${context.idempotencyKey}`;
  }

  private jobKey(context: ProviderContext, externalJobId: string) {
    return `${this.contextScope(context)}:job:${externalJobId}`;
  }

  private mappingKey(context: ProviderContext, registrationId: string) {
    return `${this.contextScope(context)}:registration:${registrationId}`;
  }

  private itemOperationKey(context: ProviderContext, operation: string, externalId: string) {
    return `${this.contextScope(context)}:${operation}:${externalId}`;
  }
}

function providerError(code: TeamManagementProviderError['code']): TeamManagementProviderError {
  return {
    code,
    retryable: ['rate_limited', 'provider_temporary', 'timeout'].includes(code),
  };
}

function exportedAthleteLabel(
  athlete: {
    registrationId: string;
    firstName: string;
    lastName: string;
    tryoutNumber?: number;
  },
  approvedFields: readonly string[],
) {
  const approved = new Set(approvedFields);
  if (approved.has('first_name') && approved.has('last_name')) {
    return `${athlete.firstName} ${athlete.lastName}`;
  }
  if (approved.has('tryout_number') && athlete.tryoutNumber !== undefined) {
    return `Tryout #${athlete.tryoutNumber}`;
  }
  // Registration IDs are opaque TryoutFlow references required to correlate item outcomes.
  return `Registration ${athlete.registrationId}`;
}

function projectRosterFields(
  athlete: {
    firstName: string;
    lastName: string;
    email?: string;
    phone?: string;
    position?: string;
    tryoutNumber?: number;
  },
  teamName: string,
  approvedFields: readonly string[],
): RosterExportProjectedFields {
  const approved = new Set(approvedFields);
  return {
    ...(approved.has('first_name') ? { firstName: athlete.firstName } : {}),
    ...(approved.has('last_name') ? { lastName: athlete.lastName } : {}),
    ...(approved.has('email') && athlete.email ? { email: athlete.email } : {}),
    ...(approved.has('phone') && athlete.phone ? { phone: athlete.phone } : {}),
    ...(approved.has('position') && athlete.position ? { position: athlete.position } : {}),
    ...(approved.has('team_name') ? { teamName } : {}),
    ...(approved.has('tryout_number') && athlete.tryoutNumber !== undefined
      ? { tryoutNumber: athlete.tryoutNumber }
      : {}),
  };
}

function inFlightStatus(
  terminal: SyncJobResult,
  state: 'pending' | 'processing',
): ProviderSyncStatus {
  if (terminal.items.length === 0) return terminal;
  const retainedCompletedItems = terminal.items.length > 1 ? 1 : 0;
  return {
    externalJobId: terminal.externalJobId,
    state,
    ...(terminal.entityMappings ? { entityMappings: terminal.entityMappings } : {}),
    items: terminal.items.map((item, index) =>
      index < retainedCompletedItems
        ? item
        : {
            itemKey: item.itemKey,
            entityType: item.entityType,
            state,
            attempts: state === 'processing' ? Math.max(1, item.attempts) : 0,
            externalRef: null,
            error: null,
          },
    ),
    mockData: terminal.mockData,
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
