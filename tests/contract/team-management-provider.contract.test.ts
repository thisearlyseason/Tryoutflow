import { describe, expect, it } from 'vitest';

import {
  athleteImportPreviewSchema,
  connectionHealthSchema,
  externalOrganizationListSchema,
  externalRosterDestinationListSchema,
  providerSyncStatusSchema,
  rosterExportPreviewSchema,
  syncJobResultSchema,
} from '../../src/modules/integrations/domain/contracts';
import {
  isTeamManagementProviderError,
  normalizeTeamManagementProviderError,
  type ConfirmedRosterExport,
  type ProviderContext,
  type TeamManagementProvider,
} from '../../src/modules/integrations/domain/provider';
import {
  createTeamManagementProviderRegistry,
  TeamManagementProviderRegistryError,
} from '../../src/infrastructure/integrations/provider-registry';
import { MockTheSquadProvider } from '../../src/infrastructure/integrations/mock-the-squad-provider';

const ids = {
  organization: '10000000-0000-4000-8000-000000000001',
  actor: '10000000-0000-4000-8000-000000000002',
  connection: '10000000-0000-4000-8000-000000000003',
  tryout: '10000000-0000-4000-8000-000000000004',
  division: '10000000-0000-4000-8000-000000000005',
  roster: '10000000-0000-4000-8000-000000000006',
  team: '10000000-0000-4000-8000-000000000007',
  registrationOne: '20000000-0000-4000-8000-000000000001',
  registrationTwo: '20000000-0000-4000-8000-000000000002',
} as const;

const context: ProviderContext = {
  organizationId: ids.organization,
  actorId: ids.actor,
  connectionId: ids.connection,
  correlationId: 'correlation-contract-0001',
  idempotencyKey: 'provider-contract-idempotency-0001',
};

async function connectProvider(
  provider: TeamManagementProvider,
  organizationId: string = ids.organization,
  actorId: string = ids.actor,
): Promise<ProviderContext> {
  const scope = `${organizationId.slice(0, 8)}-${actorId.slice(0, 8)}`;
  const challenge = await provider.beginConnection({
    organizationId,
    actorId,
    correlationId: `correlation-connect-${scope}`,
    idempotencyKey: `idempotency-connect-${scope}`,
    callbackUrl: 'https://tryoutflow.example.test/integrations/callback',
  });
  const connection = await provider.completeConnection({
    organizationId,
    actorId,
    correlationId: `correlation-complete-${scope}`,
    idempotencyKey: `idempotency-complete-${scope}`,
    challengeId: challenge.challengeId,
    callbackParameters: { mockApproval: 'approved' },
  });
  return {
    organizationId,
    actorId,
    connectionId: connection.connectionId,
    correlationId: `correlation-context-${scope}`,
    idempotencyKey: 'provider-contract-idempotency-0001',
  };
}

function exportRequest(): ConfirmedRosterExport {
  return {
    previewId: 'preview-contract-0001',
    confirmationToken: 'confirm-contract-0001',
    destination: {
      organization: {
        providerKey: 'the-squad',
        entityType: 'organization',
        externalId: 'mock-org-001',
        displayName: 'Mock Organization 001',
        mockData: true,
      },
      season: {
        providerKey: 'the-squad',
        entityType: 'season',
        externalId: 'mock-season-2026',
        displayName: 'Mock Season 2026',
        mockData: true,
      },
      division: {
        providerKey: 'the-squad',
        entityType: 'division',
        externalId: 'mock-division-u18',
        displayName: 'Mock Division U18',
        mockData: true,
      },
      team: {
        providerKey: 'the-squad',
        entityType: 'team',
        externalId: 'mock-team-blue',
        displayName: 'Mock Team Blue',
        mockData: true,
      },
      displayLabel: 'Mock Season 2026 / Mock Division U18 / Mock Team Blue',
      mockData: true,
    },
    approvedFields: ['first_name', 'last_name', 'position', 'team_name'],
    roster: {
      organizationId: ids.organization,
      tryoutId: ids.tryout,
      divisionId: ids.division,
      rosterVersionId: ids.roster,
      version: 3,
      state: 'finalized',
      finalizedAt: '2026-08-29T18:30:00.000Z',
      teams: [{ id: ids.team, name: 'Mock Team Blue' }],
      athletes: [
        {
          registrationId: ids.registrationOne,
          firstName: 'Synthetic',
          lastName: 'Athlete 001',
          position: 'Mock Position A',
          teamId: ids.team,
        },
        {
          registrationId: ids.registrationTwo,
          firstName: 'Synthetic',
          lastName: 'Athlete 002',
          position: 'Mock Position B',
          teamId: ids.team,
        },
      ],
    },
  };
}

function exportPreviewRequest(request = exportRequest()) {
  return {
    destination: request.destination,
    approvedFields: request.approvedFields,
    roster: request.roster,
  };
}

async function expectTeamManagementProviderContract(
  create: () => TeamManagementProvider,
  options: { repeatExportMustNotDuplicate: true; completedItemsMustSurviveRetry: true },
) {
  const provider = create();
  expect(provider.providerKey).toBe('the-squad');

  const challenge = await provider.beginConnection({
    organizationId: ids.organization,
    actorId: ids.actor,
    correlationId: 'correlation-contract-0002',
    idempotencyKey: 'connection-contract-idempotency-0002',
    callbackUrl: 'https://tryoutflow.example.test/integrations/callback',
  });
  expect(challenge).toMatchObject({ mode: 'mock', mockData: true });
  expect(challenge).not.toHaveProperty('authorizationUrl');
  expect(Date.parse(challenge.expiresAt)).toBeGreaterThan(Date.parse('2026-08-30T00:00:00.000Z'));

  const connection = await provider.completeConnection({
    organizationId: ids.organization,
    actorId: ids.actor,
    correlationId: 'correlation-contract-0003',
    idempotencyKey: 'connection-contract-idempotency-0003',
    challengeId: challenge.challengeId,
    callbackParameters: { mockApproval: 'approved' },
  });
  expect(connection).toMatchObject({
    providerKey: 'the-squad',
    state: 'connected',
    mockData: true,
  });

  const connectedContext = { ...context, connectionId: connection.connectionId };

  expect(connectionHealthSchema.parse(await provider.verifyConnection(connectedContext))).toEqual({
    state: 'healthy',
    checkedAt: '2026-08-29T18:30:00.000Z',
    mockData: true,
  });
  const organizations = externalOrganizationListSchema.parse(
    await provider.listOrganizations(connectedContext),
  );
  expect(organizations).toHaveLength(1);
  expect(organizations[0]).toMatchObject({ externalId: 'mock-org-001', mockData: true });
  const destinations = externalRosterDestinationListSchema.parse(
    await provider.listDestinations(connectedContext, organizations[0]!),
  );
  expect(destinations).toHaveLength(1);
  expect(destinations[0]).toMatchObject({ mockData: true });

  const importPreview = athleteImportPreviewSchema.parse(
    await provider.previewAthleteImport(connectedContext, {
      sourceOrganization: organizations[0]!,
      approvedFields: ['first_name', 'last_name', 'position'],
    }),
  );
  expect(importPreview.items.length).toBeGreaterThan(0);
  expect(importPreview.items.map((item) => item.disposition)).toContain('duplicate');
  const importResult = syncJobResultSchema.parse(
    await provider.importAthletes(
      { ...connectedContext, idempotencyKey: 'import-contract-idempotency-0004' },
      {
        previewId: importPreview.previewId,
        confirmationToken: importPreview.confirmationToken,
        sourceOrganization: organizations[0]!,
        approvedFields: ['first_name', 'last_name', 'position'],
        items: importPreview.items,
      },
    ),
  );
  expect(importResult.state).toBe('completed');
  expect(importResult.items.map((item) => item.state)).toContain('skipped');

  const request = exportRequest();
  const preview = rosterExportPreviewSchema.parse(
    await provider.previewRosterExport(connectedContext, {
      destination: request.destination,
      approvedFields: request.approvedFields,
      roster: request.roster,
    }),
  );
  expect(preview).toMatchObject({ totalItems: 2, mockData: true });

  const confirmed = {
    ...request,
    previewId: preview.previewId,
    confirmationToken: preview.confirmationToken,
  };
  const first = syncJobResultSchema.parse(
    await provider.exportFinalizedRoster(connectedContext, confirmed),
  );
  const second = syncJobResultSchema.parse(
    await provider.exportFinalizedRoster(connectedContext, confirmed),
  );
  expect(first.state).toBe('completed');
  if (options.repeatExportMustNotDuplicate) expect(second).toEqual(first);
  expect(new Set(second.items.map((item) => item.externalRef?.externalId)).size).toBe(2);

  const status = providerSyncStatusSchema.parse(
    await provider.getSyncStatus(connectedContext, first.externalJobId),
  );
  expect(status).toEqual(first);
  await expect(provider.disconnect(connectedContext)).resolves.toBeUndefined();
  await expect(
    provider.verifyConnection({
      ...connectedContext,
      connectionId: '60000000-0000-4000-8000-000000000001',
    }),
  ).rejects.toMatchObject({ code: 'authentication_required', retryable: false });
  await expect(provider.verifyConnection(connectedContext)).rejects.toMatchObject({
    code: 'authentication_required',
    retryable: false,
  });
}

describe('TeamManagementProvider contract', () => {
  it('implements every provider method without a live The Squad endpoint', async () => {
    await expectTeamManagementProviderContract(
      () => new MockTheSquadProvider({ fixture: 'success' }),
      { repeatExportMustNotDuplicate: true, completedItemsMustSurviveRetry: true },
    );
  });

  it('preserves completed items while retrying only a deterministic failed item', async () => {
    const provider = new MockTheSquadProvider({ fixture: 'partial-failure' });
    const connectedContext = await connectProvider(provider);
    const partialContext = {
      ...connectedContext,
      idempotencyKey: 'provider-contract-partial-0001',
    };
    const request = exportRequest();
    const preview = await provider.previewRosterExport(
      connectedContext,
      exportPreviewRequest(request),
    );
    const confirmed = {
      ...request,
      previewId: preview.previewId,
      confirmationToken: preview.confirmationToken,
    };
    const partial = syncJobResultSchema.parse(
      await provider.exportFinalizedRoster(partialContext, confirmed),
    );
    expect(partial.state).toBe('partially_completed');
    expect(
      partial.items.map(({ itemKey, state, attempts }) => ({ itemKey, state, attempts })),
    ).toEqual([
      { itemKey: `athlete:${ids.registrationOne}`, state: 'completed', attempts: 1 },
      { itemKey: `athlete:${ids.registrationTwo}`, state: 'failed', attempts: 1 },
    ]);

    const retried = syncJobResultSchema.parse(
      await provider.exportFinalizedRoster(partialContext, confirmed),
    );
    expect(retried.state).toBe('completed');
    expect(
      retried.items.map(({ itemKey, state, attempts }) => ({ itemKey, state, attempts })),
    ).toEqual([
      { itemKey: `athlete:${ids.registrationOne}`, state: 'completed', attempts: 1 },
      { itemKey: `athlete:${ids.registrationTwo}`, state: 'completed', attempts: 2 },
    ]);
    expect(retried.items[0]?.externalRef).toEqual(partial.items[0]?.externalRef);
  });

  it('derives a total failure when no export item has a provider mapping', async () => {
    const provider = new MockTheSquadProvider({ fixture: 'success' });
    const connectedContext = await connectProvider(provider);
    const failedContext = {
      ...connectedContext,
      idempotencyKey: 'provider-contract-total-failure-0001',
    };
    const request = exportRequest();
    request.roster.athletes[0]!.registrationId = '40000000-0000-4000-8000-000000000001';
    request.roster.athletes[1]!.registrationId = '40000000-0000-4000-8000-000000000002';
    const preview = await provider.previewRosterExport(
      failedContext,
      exportPreviewRequest(request),
    );
    const result = syncJobResultSchema.parse(
      await provider.exportFinalizedRoster(failedContext, {
        ...request,
        previewId: preview.previewId,
        confirmationToken: preview.confirmationToken,
      }),
    );
    expect(result.state).toBe('failed');
    expect(result.items.map((item) => item.state)).toEqual(['requires_review', 'requires_review']);
  });

  it('treats an empty finalized roster export as an idempotent completed no-op', async () => {
    const provider = new MockTheSquadProvider({ fixture: 'success' });
    const connectedContext = await connectProvider(provider);
    const emptyContext = {
      ...connectedContext,
      idempotencyKey: 'provider-contract-empty-export-0001',
    };
    const request = exportRequest();
    request.roster.athletes = [];
    const preview = await provider.previewRosterExport(emptyContext, exportPreviewRequest(request));
    expect(preview).toMatchObject({ totalItems: 0, items: [] });
    const result = await provider.exportFinalizedRoster(emptyContext, {
      ...request,
      previewId: preview.previewId,
      confirmationToken: preview.confirmationToken,
    });
    expect(result).toMatchObject({ state: 'completed', items: [] });
    await expect(
      provider.exportFinalizedRoster(emptyContext, {
        ...request,
        previewId: preview.previewId,
        confirmationToken: preview.confirmationToken,
      }),
    ).resolves.toEqual(result);
  });

  it('rejects a changed handoff under one idempotency key without replacing its result', async () => {
    const provider = new MockTheSquadProvider({ fixture: 'success' });
    const connectedContext = await connectProvider(provider);
    const original = exportRequest();
    const originalPreview = await provider.previewRosterExport(
      connectedContext,
      exportPreviewRequest(original),
    );
    const completed = await provider.exportFinalizedRoster(connectedContext, {
      ...original,
      previewId: originalPreview.previewId,
      confirmationToken: originalPreview.confirmationToken,
    });
    const changed = structuredClone(original);
    changed.roster.athletes[0]!.firstName = 'Changed';
    const changedPreview = await provider.previewRosterExport(
      connectedContext,
      exportPreviewRequest(changed),
    );
    await expect(
      provider.exportFinalizedRoster(connectedContext, {
        ...changed,
        previewId: changedPreview.previewId,
        confirmationToken: changedPreview.confirmationToken,
      }),
    ).rejects.toEqual({ code: 'conflict', retryable: false });
    await expect(
      provider.getSyncStatus(connectedContext, completed.externalJobId),
    ).resolves.toEqual(completed);
  });

  it('returns cloned immutable results and never mutates request snapshots', async () => {
    const provider = new MockTheSquadProvider({ fixture: 'success' });
    const connectedContext = await connectProvider(provider);
    const request = exportPreviewRequest(exportRequest());
    const before = structuredClone(request);
    const preview = await provider.previewRosterExport(connectedContext, request);
    expect(request).toEqual(before);
    expect(Object.isFrozen(preview)).toBe(true);
    expect(Object.isFrozen(preview.items)).toBe(true);
    const second = await provider.previewRosterExport(connectedContext, request);
    expect(second).not.toBe(preview);
    expect(second).toEqual(preview);
  });

  it('limits import preview fields to the explicitly approved field set', async () => {
    const provider = new MockTheSquadProvider({ fixture: 'success' });
    const connectedContext = await connectProvider(provider);
    const approvedContext = {
      ...connectedContext,
      idempotencyKey: 'provider-contract-fields-0001',
    };
    const sourceOrganization = (await provider.listOrganizations(approvedContext))[0]!;
    const preview = await provider.previewAthleteImport(approvedContext, {
      sourceOrganization,
      approvedFields: ['first_name', 'last_name'],
    });
    expect(preview.items.every((item) => !('position' in item.fields))).toBe(true);
    await expect(
      provider.importAthletes(approvedContext, {
        sourceOrganization,
        approvedFields: ['first_name', 'last_name'],
        previewId: preview.previewId,
        confirmationToken: preview.confirmationToken,
        items: preview.items,
      }),
    ).resolves.toMatchObject({ state: 'completed' });
  });

  it('binds connections, jobs, mappings, and raw idempotency keys to the exact context scope', async () => {
    const provider = new MockTheSquadProvider({ fixture: 'success' });
    const firstContext = await connectProvider(provider);
    const secondOrganization = '30000000-0000-4000-8000-000000000001';
    const secondActor = '30000000-0000-4000-8000-000000000002';
    const secondContext = await connectProvider(provider, secondOrganization, secondActor);
    const sharedKey = 'provider-contract-shared-raw-key';

    await expect(
      provider.verifyConnection({ ...firstContext, actorId: secondActor }),
    ).rejects.toEqual({ code: 'permission_denied', retryable: false });
    await expect(
      provider.listOrganizations({ ...firstContext, organizationId: secondOrganization }),
    ).rejects.toEqual({ code: 'permission_denied', retryable: false });
    await expect(
      provider.disconnect({
        ...firstContext,
        connectionId: '90000000-0000-4000-8000-000000000001',
      }),
    ).rejects.toEqual({ code: 'authentication_required', retryable: false });
    await expect(
      provider.disconnect({ ...firstContext, connectionId: secondContext.connectionId }),
    ).rejects.toEqual({ code: 'permission_denied', retryable: false });

    const firstRequest = exportRequest();
    const firstPreview = await provider.previewRosterExport(
      firstContext,
      exportPreviewRequest(firstRequest),
    );
    const firstResult = await provider.exportFinalizedRoster(
      { ...firstContext, idempotencyKey: sharedKey },
      {
        ...firstRequest,
        previewId: firstPreview.previewId,
        confirmationToken: firstPreview.confirmationToken,
      },
    );
    await expect(provider.getSyncStatus(secondContext, firstResult.externalJobId)).rejects.toEqual({
      code: 'not_found',
      retryable: false,
    });

    const secondRequest = exportRequest();
    secondRequest.roster.organizationId = secondOrganization;
    const secondPreview = await provider.previewRosterExport(
      secondContext,
      exportPreviewRequest(secondRequest),
    );
    expect(secondPreview.items.every((item) => item.operation === 'create')).toBe(true);
    const secondResult = await provider.exportFinalizedRoster(
      { ...secondContext, idempotencyKey: sharedKey },
      {
        ...secondRequest,
        previewId: secondPreview.previewId,
        confirmationToken: secondPreview.confirmationToken,
      },
    );
    expect(secondResult.externalJobId).not.toBe(firstResult.externalJobId);
    expect(secondResult.items[0]?.externalRef?.externalId).not.toBe(
      firstResult.items[0]?.externalRef?.externalId,
    );

    const sourceOrganization = (await provider.listOrganizations(firstContext))[0]!;
    const importPreview = await provider.previewAthleteImport(firstContext, {
      sourceOrganization,
      approvedFields: ['first_name', 'last_name'],
    });
    await expect(
      provider.importAthletes(
        { ...firstContext, idempotencyKey: sharedKey },
        {
          sourceOrganization,
          approvedFields: ['first_name', 'last_name'],
          previewId: importPreview.previewId,
          confirmationToken: importPreview.confirmationToken,
          items: importPreview.items,
        },
      ),
    ).resolves.toMatchObject({ state: 'completed' });

    await expect(provider.disconnect(firstContext)).resolves.toBeUndefined();
    await expect(provider.verifyConnection(firstContext)).rejects.toEqual({
      code: 'authentication_required',
      retryable: false,
    });
    await expect(provider.verifyConnection(secondContext)).resolves.toMatchObject({
      state: 'healthy',
    });
    const reconnected = await connectProvider(provider);
    expect(reconnected.connectionId).toBe(firstContext.connectionId);
    await expect(provider.verifyConnection(reconnected)).resolves.toMatchObject({
      state: 'healthy',
    });
  });

  it('models in-flight sync status separately from terminal submission results', async () => {
    expect(
      providerSyncStatusSchema.parse({
        externalJobId: 'mock-job-processing',
        state: 'processing',
        items: [
          {
            itemKey: 'athlete:one',
            entityType: 'athlete',
            state: 'processing',
            attempts: 1,
            externalRef: null,
            error: null,
          },
        ],
        mockData: true,
      }).state,
    ).toBe('processing');
    expect(() =>
      syncJobResultSchema.parse({
        externalJobId: 'mock-job-processing',
        state: 'processing',
        items: [
          {
            itemKey: 'athlete:one',
            entityType: 'athlete',
            state: 'processing',
            attempts: 1,
            externalRef: null,
            error: null,
          },
        ],
        mockData: true,
      }),
    ).toThrow();
    expect(() =>
      providerSyncStatusSchema.parse({
        externalJobId: 'mock-job-incoherent-pending',
        state: 'pending',
        items: [
          {
            itemKey: 'athlete:one',
            entityType: 'athlete',
            state: 'pending',
            attempts: 1,
            externalRef: {
              providerKey: 'the-squad',
              entityType: 'athlete',
              externalId: 'mock-athlete-one',
              displayName: 'Already created',
              mockData: true,
            },
            error: null,
          },
        ],
        mockData: true,
      }),
    ).toThrow();

    const provider = new MockTheSquadProvider({
      fixture: 'success',
      syncStatusTransitions: ['processing'],
    });
    const connectedContext = await connectProvider(provider);
    const request = exportRequest();
    const preview = await provider.previewRosterExport(
      connectedContext,
      exportPreviewRequest(request),
    );
    const terminal = await provider.exportFinalizedRoster(connectedContext, {
      ...request,
      previewId: preview.previewId,
      confirmationToken: preview.confirmationToken,
    });
    const inFlight = await provider.getSyncStatus(connectedContext, terminal.externalJobId);
    expect(inFlight.state).toBe('processing');
    expect(inFlight.items.map((item) => item.state)).toEqual(['completed', 'processing']);
    expect(inFlight.items[0]).toEqual(terminal.items[0]);
    await expect(provider.getSyncStatus(connectedContext, terminal.externalJobId)).resolves.toEqual(
      terminal,
    );
  });

  it('projects roster previews and export references to only approved identity fields', async () => {
    const provider = new MockTheSquadProvider({ fixture: 'success' });
    const connectedContext = await connectProvider(provider);
    const request = exportRequest();
    request.approvedFields = ['position'];
    request.roster.athletes[0]!.firstName = 'WITHHELD-FIRST';
    request.roster.athletes[0]!.lastName = 'WITHHELD-LAST';
    request.roster.athletes[0]!.email = 'withheld@example.test';
    request.roster.athletes[0]!.phone = '+1 555 555 0101';
    request.roster.athletes[0]!.tryoutNumber = 9876;
    const before = structuredClone(request);

    const preview = await provider.previewRosterExport(
      connectedContext,
      exportPreviewRequest(request),
    );
    expect(JSON.stringify(preview)).not.toMatch(
      /WITHHELD-FIRST|WITHHELD-LAST|withheld@example\.test|555 555|9876/u,
    );
    expect(preview.items[0]?.displayLabel).toBe(`Registration ${ids.registrationOne}`);
    expect(preview.items[0]?.fields).toEqual({ position: 'Mock Position A' });
    const result = await provider.exportFinalizedRoster(connectedContext, {
      ...request,
      previewId: preview.previewId,
      confirmationToken: preview.confirmationToken,
    });
    expect(JSON.stringify(result)).not.toMatch(
      /WITHHELD-FIRST|WITHHELD-LAST|withheld@example\.test|555 555|9876/u,
    );
    expect(result.items[0]?.externalRef?.displayName).toBe(`Registration ${ids.registrationOne}`);
    expect(request).toEqual(before);
  });

  it('strictly rejects malformed, oversized, Unicode-confusable, and inconsistent outputs', () => {
    expect(() =>
      connectionHealthSchema.parse({ state: 'healthy', checkedAt: 'bad', mockData: true }),
    ).toThrow();
    expect(() =>
      externalOrganizationListSchema.parse([
        {
          providerKey: 'the-squad',
          entityType: 'organization',
          externalId: `mock-${'x'.repeat(201)}`,
          displayName: 'Mock',
          mockData: true,
        },
      ]),
    ).toThrow();
    const duplicateOrganization = {
      providerKey: 'the-squad',
      entityType: 'organization' as const,
      externalId: 'mock-org-001',
      displayName: 'Mock Organization',
      mockData: true,
    };
    expect(() =>
      externalOrganizationListSchema.parse([duplicateOrganization, duplicateOrganization]),
    ).toThrow();
    expect(() =>
      athleteImportPreviewSchema.parse({
        previewId: 'preview-contract-0001',
        confirmationToken: 'confirm-contract-0001',
        items: [
          {
            externalAthlete: {
              providerKey: 'the-squad',
              entityType: 'athlete',
              externalId: 'mock-athlete-001',
              displayName: 'Synthetic Athlete',
              mockData: true,
            },
            fields: { firstName: 'Synthetic', lastName: 'Athlete' },
            disposition: 'new',
          },
        ],
        mockData: false,
      }),
    ).toThrow();
    expect(() =>
      externalOrganizationListSchema.parse([
        {
          providerKey: 'the-squаd',
          entityType: 'organization',
          externalId: 'mock-org-001',
          displayName: 'Mock',
          mockData: true,
        },
      ]),
    ).toThrow();
    expect(() =>
      syncJobResultSchema.parse({
        externalJobId: 'mock-job-001',
        state: 'completed',
        items: [
          {
            itemKey: 'athlete:one',
            entityType: 'athlete',
            state: 'failed',
            attempts: 1,
            externalRef: null,
            error: { code: 'provider_rejected', retryable: false },
          },
        ],
        mockData: true,
      }),
    ).toThrow();
    expect(() =>
      syncJobResultSchema.parse({
        externalJobId: 'mock-job-001',
        state: 'completed',
        items: [
          {
            itemKey: 'athlete:one',
            entityType: 'athlete',
            state: 'completed',
            attempts: 1,
            externalRef: {
              providerKey: 'the-squad',
              entityType: 'team',
              externalId: 'mock-team-one',
              displayName: 'Wrong type',
              mockData: true,
            },
            error: null,
          },
        ],
        mockData: true,
      }),
    ).toThrow();
    expect(() =>
      syncJobResultSchema.parse({
        externalJobId: 'mock-job-001',
        state: 'failed',
        items: [
          {
            itemKey: 'athlete:one',
            entityType: 'athlete',
            state: 'failed',
            attempts: 1,
            externalRef: null,
            error: { code: 'provider_temporary', retryable: false },
          },
        ],
        mockData: true,
      }),
    ).toThrow();
  });

  it('normalizes known errors, timeouts, and malformed provider values without leaking details', () => {
    const temporary = normalizeTeamManagementProviderError({
      code: 'provider_temporary',
      retryable: true,
      stack: 'secret stack',
    });
    expect(temporary).toEqual({ code: 'provider_temporary', retryable: true });
    expect(isTeamManagementProviderError(temporary)).toBe(true);
    expect(normalizeTeamManagementProviderError(new DOMException('late', 'TimeoutError'))).toEqual({
      code: 'timeout',
      retryable: true,
    });
    expect(normalizeTeamManagementProviderError({ endpoint: 'secret', token: 'secret' })).toEqual({
      code: 'provider_configuration',
      retryable: false,
    });
  });

  it('returns the stable invalid-request taxonomy for malformed runtime inputs', async () => {
    const provider = new MockTheSquadProvider({ fixture: 'success' });
    const connectedContext = await connectProvider(provider);
    await expect(
      provider.verifyConnection({ ...connectedContext, correlationId: 'short' }),
    ).rejects.toEqual({ code: 'invalid_request', retryable: false });
    await expect(
      provider.getSyncStatus(connectedContext, '\u043c\u043e\u0441k-job'),
    ).rejects.toEqual({
      code: 'invalid_request',
      retryable: false,
    });
  });

  it('enables only the exact known mock provider through an explicit server feature flag', () => {
    const disabled = createTeamManagementProviderRegistry({});
    expect(() => disabled.get('the-squad')).toThrowError(TeamManagementProviderRegistryError);
    expect(() => disabled.get('THE-SQUAD')).toThrowError(TeamManagementProviderRegistryError);
    expect(() => disabled.get('the-squаd')).toThrowError(TeamManagementProviderRegistryError);

    const enabled = createTeamManagementProviderRegistry({
      ENABLE_MOCK_THE_SQUAD_PROVIDER: 'true',
    });
    const provider = enabled.get('the-squad');
    expect(provider).toBeInstanceOf(MockTheSquadProvider);
    expect(enabled.get('the-squad')).toBe(provider);
    expect(enabled.list()).toEqual([
      { providerKey: 'the-squad', displayName: 'The Squad (demo/mock)', mockData: true },
    ]);
  });

  it('binds a connection challenge to the organization and actor that began it', async () => {
    const provider = new MockTheSquadProvider({ fixture: 'success' });
    const challenge = await provider.beginConnection({
      organizationId: ids.organization,
      actorId: ids.actor,
      correlationId: 'correlation-contract-scope-0001',
      idempotencyKey: 'connection-contract-scope-0001',
      callbackUrl: 'https://tryoutflow.example.test/integrations/callback',
    });
    await expect(
      provider.completeConnection({
        organizationId: ids.organization,
        actorId: '50000000-0000-4000-8000-000000000001',
        correlationId: 'correlation-contract-scope-0002',
        idempotencyKey: 'connection-contract-scope-0002',
        challengeId: challenge.challengeId,
        callbackParameters: { mockApproval: 'approved' },
      }),
    ).rejects.toEqual({ code: 'connection_invalid', retryable: false });
  });

  it('consumes an exact-scoped connection challenge on its first callback attempt', async () => {
    const provider = new MockTheSquadProvider({ fixture: 'success' });
    const begin = () =>
      provider.beginConnection({
        organizationId: ids.organization,
        actorId: ids.actor,
        correlationId: 'correlation-contract-once-0001',
        idempotencyKey: 'connection-contract-once-0001',
        callbackUrl: 'https://tryoutflow.example.test/integrations/callback',
      });
    const callback = (challengeId: string, mockApproval: string) => ({
      organizationId: ids.organization,
      actorId: ids.actor,
      correlationId: 'correlation-contract-once-0002',
      idempotencyKey: 'connection-contract-once-0002',
      challengeId,
      callbackParameters: { mockApproval },
    });

    const deniedChallenge = await begin();
    await expect(
      provider.completeConnection(callback(deniedChallenge.challengeId, 'denied')),
    ).rejects.toEqual({ code: 'connection_invalid', retryable: false });
    await expect(
      provider.completeConnection(callback(deniedChallenge.challengeId, 'approved')),
    ).rejects.toEqual({ code: 'connection_invalid', retryable: false });

    const approvedChallenge = await begin();
    const attempts = await Promise.allSettled([
      provider.completeConnection(callback(approvedChallenge.challengeId, 'approved')),
      provider.completeConnection(callback(approvedChallenge.challengeId, 'approved')),
    ]);
    expect(attempts.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(attempts.filter((result) => result.status === 'rejected')).toEqual([
      expect.objectContaining({ reason: { code: 'connection_invalid', retryable: false } }),
    ]);

    const connection = attempts.find((result) => result.status === 'fulfilled')!.value;
    const connectedContext = { ...context, connectionId: connection.connectionId };
    await provider.disconnect(connectedContext);
    await expect(
      provider.completeConnection(callback(approvedChallenge.challengeId, 'approved')),
    ).rejects.toEqual({ code: 'connection_invalid', retryable: false });
    await expect(provider.verifyConnection(connectedContext)).rejects.toEqual({
      code: 'authentication_required',
      retryable: false,
    });

    const freshChallenge = await begin();
    expect(freshChallenge.challengeId).not.toBe(approvedChallenge.challengeId);
    await expect(
      provider.completeConnection(callback(approvedChallenge.challengeId, 'approved')),
    ).rejects.toEqual({ code: 'connection_invalid', retryable: false });
    await expect(
      provider.completeConnection(callback(freshChallenge.challengeId, 'approved')),
    ).resolves.toMatchObject({ connectionId: connection.connectionId, state: 'connected' });
  });

  it('does not let a cross-scope callback consume another scope challenge', async () => {
    const provider = new MockTheSquadProvider({ fixture: 'success' });
    const challenge = await provider.beginConnection({
      organizationId: ids.organization,
      actorId: ids.actor,
      correlationId: 'correlation-contract-cross-scope-0001',
      idempotencyKey: 'connection-contract-cross-scope-0001',
      callbackUrl: 'https://tryoutflow.example.test/integrations/callback',
    });
    await expect(
      provider.completeConnection({
        organizationId: '50000000-0000-4000-8000-000000000001',
        actorId: ids.actor,
        correlationId: 'correlation-contract-cross-scope-0002',
        idempotencyKey: 'connection-contract-cross-scope-0002',
        challengeId: challenge.challengeId,
        callbackParameters: { mockApproval: 'approved' },
      }),
    ).rejects.toEqual({ code: 'connection_invalid', retryable: false });
    await expect(
      provider.completeConnection({
        organizationId: ids.organization,
        actorId: ids.actor,
        correlationId: 'correlation-contract-cross-scope-0003',
        idempotencyKey: 'connection-contract-cross-scope-0003',
        challengeId: challenge.challengeId,
        callbackParameters: { mockApproval: 'approved' },
      }),
    ).resolves.toMatchObject({ state: 'connected' });
  });

  it('canonicalizes approved field sets before import and export derivations', async () => {
    const provider = new MockTheSquadProvider({ fixture: 'success' });
    const connectedContext = await connectProvider(provider);
    const sourceOrganization = (await provider.listOrganizations(connectedContext))[0]!;

    const importFirstRequest: Parameters<TeamManagementProvider['previewAthleteImport']>[1] = {
      sourceOrganization,
      approvedFields: ['position', 'last_name', 'first_name'],
    };
    const importFirstInput = structuredClone(importFirstRequest);
    const importFirst = await provider.previewAthleteImport(connectedContext, importFirstInput);
    expect(importFirstInput).toEqual(importFirstRequest);
    const importReordered = await provider.previewAthleteImport(connectedContext, {
      sourceOrganization,
      approvedFields: ['first_name', 'position', 'last_name'],
    });
    expect(JSON.stringify(importReordered)).toBe(JSON.stringify(importFirst));
    const imported = await provider.importAthletes(
      { ...connectedContext, idempotencyKey: 'canonical-import-fields-0001' },
      {
        sourceOrganization,
        approvedFields: ['position', 'first_name', 'last_name'],
        previewId: importFirst.previewId,
        confirmationToken: importFirst.confirmationToken,
        items: importFirst.items,
      },
    );
    await expect(
      provider.importAthletes(
        { ...connectedContext, idempotencyKey: 'canonical-import-fields-0001' },
        {
          sourceOrganization,
          approvedFields: ['last_name', 'position', 'first_name'],
          previewId: importFirst.previewId,
          confirmationToken: importFirst.confirmationToken,
          items: importFirst.items,
        },
      ),
    ).resolves.toEqual(imported);
    const changedImportPreview = await provider.previewAthleteImport(connectedContext, {
      sourceOrganization,
      approvedFields: ['first_name', 'last_name'],
    });
    await expect(
      provider.importAthletes(
        { ...connectedContext, idempotencyKey: 'canonical-import-fields-0001' },
        {
          sourceOrganization,
          approvedFields: ['first_name', 'last_name'],
          previewId: changedImportPreview.previewId,
          confirmationToken: changedImportPreview.confirmationToken,
          items: changedImportPreview.items,
        },
      ),
    ).rejects.toEqual({ code: 'conflict', retryable: false });

    const exportFirstRequest = exportRequest();
    exportFirstRequest.approvedFields = ['team_name', 'last_name', 'first_name', 'position'];
    const exportReorderedRequest = structuredClone(exportFirstRequest);
    exportReorderedRequest.approvedFields = ['position', 'first_name', 'team_name', 'last_name'];
    const exportFirst = await provider.previewRosterExport(
      connectedContext,
      exportPreviewRequest(exportFirstRequest),
    );
    expect(exportFirstRequest.approvedFields).toEqual([
      'team_name',
      'last_name',
      'first_name',
      'position',
    ]);
    const exportReordered = await provider.previewRosterExport(
      connectedContext,
      exportPreviewRequest(exportReorderedRequest),
    );
    expect(JSON.stringify(exportReordered)).toBe(JSON.stringify(exportFirst));
    const exportContext = {
      ...connectedContext,
      idempotencyKey: 'canonical-export-fields-0001',
    };
    const exported = await provider.exportFinalizedRoster(exportContext, {
      ...exportFirstRequest,
      previewId: exportFirst.previewId,
      confirmationToken: exportFirst.confirmationToken,
    });
    await expect(
      provider.exportFinalizedRoster(exportContext, {
        ...exportReorderedRequest,
        previewId: exportFirst.previewId,
        confirmationToken: exportFirst.confirmationToken,
      }),
    ).resolves.toEqual(exported);

    const changedRequest = structuredClone(exportFirstRequest);
    changedRequest.approvedFields = ['first_name', 'last_name'];
    const changedPreview = await provider.previewRosterExport(
      exportContext,
      exportPreviewRequest(changedRequest),
    );
    await expect(
      provider.exportFinalizedRoster(exportContext, {
        ...changedRequest,
        previewId: changedPreview.previewId,
        confirmationToken: changedPreview.confirmationToken,
      }),
    ).rejects.toEqual({ code: 'conflict', retryable: false });
  });

  it('rejects non-monotonic mock status transition fixtures before any job runs', () => {
    const invalidTransitions: readonly (readonly string[])[] = [
      ['processing', 'pending'],
      ['pending', 'pending'],
      ['processing', 'processing'],
      ['completed', 'processing'],
    ];
    for (const syncStatusTransitions of invalidTransitions) {
      expect(
        () =>
          new MockTheSquadProvider({
            fixture: 'success',
            syncStatusTransitions: syncStatusTransitions as never,
          }),
      ).toThrowError(expect.objectContaining({ code: 'provider_configuration', retryable: false }));
    }
    for (const syncStatusTransitions of [
      [],
      ['pending'],
      ['processing'],
      ['pending', 'processing'],
    ] as const) {
      expect(
        () => new MockTheSquadProvider({ fixture: 'success', syncStatusTransitions }),
      ).not.toThrow();
    }
  });

  it('reports valid configured statuses without state or attempt regression', async () => {
    const provider = new MockTheSquadProvider({
      fixture: 'success',
      syncStatusTransitions: ['pending', 'processing'],
    });
    const connectedContext = await connectProvider(provider);
    const request = exportRequest();
    const preview = await provider.previewRosterExport(
      connectedContext,
      exportPreviewRequest(request),
    );
    const terminal = await provider.exportFinalizedRoster(connectedContext, {
      ...request,
      previewId: preview.previewId,
      confirmationToken: preview.confirmationToken,
    });
    const statuses = [
      await provider.getSyncStatus(connectedContext, terminal.externalJobId),
      await provider.getSyncStatus(connectedContext, terminal.externalJobId),
      await provider.getSyncStatus(connectedContext, terminal.externalJobId),
      await provider.getSyncStatus(connectedContext, terminal.externalJobId),
    ];
    expect(statuses.map((status) => status.state)).toEqual([
      'pending',
      'processing',
      'completed',
      'completed',
    ]);
    for (let itemIndex = 0; itemIndex < terminal.items.length; itemIndex += 1) {
      const attempts = statuses.map((status) => status.items[itemIndex]!.attempts);
      expect(attempts).toEqual([...attempts].sort((left, right) => left - right));
    }
  });
});
