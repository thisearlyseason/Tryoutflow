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

  expect(connectionHealthSchema.parse(await provider.verifyConnection(context))).toEqual({
    state: 'healthy',
    checkedAt: '2026-08-29T18:30:00.000Z',
    mockData: true,
  });
  const organizations = externalOrganizationListSchema.parse(
    await provider.listOrganizations(context),
  );
  expect(organizations).toHaveLength(1);
  expect(organizations[0]).toMatchObject({ externalId: 'mock-org-001', mockData: true });
  const destinations = externalRosterDestinationListSchema.parse(
    await provider.listDestinations(context, organizations[0]!),
  );
  expect(destinations).toHaveLength(1);
  expect(destinations[0]).toMatchObject({ mockData: true });

  const importPreview = athleteImportPreviewSchema.parse(
    await provider.previewAthleteImport(context, {
      sourceOrganization: organizations[0]!,
      approvedFields: ['first_name', 'last_name', 'position'],
    }),
  );
  expect(importPreview.items.length).toBeGreaterThan(0);
  expect(importPreview.items.map((item) => item.disposition)).toContain('duplicate');
  const importResult = syncJobResultSchema.parse(
    await provider.importAthletes(
      { ...context, idempotencyKey: 'import-contract-idempotency-0004' },
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
    await provider.previewRosterExport(context, {
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
  const first = syncJobResultSchema.parse(await provider.exportFinalizedRoster(context, confirmed));
  const second = syncJobResultSchema.parse(
    await provider.exportFinalizedRoster(context, confirmed),
  );
  expect(first.state).toBe('completed');
  if (options.repeatExportMustNotDuplicate) expect(second).toEqual(first);
  expect(new Set(second.items.map((item) => item.externalRef?.externalId)).size).toBe(2);

  const status = providerSyncStatusSchema.parse(
    await provider.getSyncStatus(context, first.externalJobId),
  );
  expect(status).toEqual(first);
  await expect(provider.disconnect(context)).resolves.toBeUndefined();
  await expect(
    provider.verifyConnection({
      ...context,
      connectionId: '60000000-0000-4000-8000-000000000001',
    }),
  ).resolves.toMatchObject({ state: 'healthy' });
  await expect(provider.verifyConnection(context)).rejects.toMatchObject({
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
    const partialContext = { ...context, idempotencyKey: 'provider-contract-partial-0001' };
    const request = exportRequest();
    const preview = await provider.previewRosterExport(context, exportPreviewRequest(request));
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
    const failedContext = { ...context, idempotencyKey: 'provider-contract-total-failure-0001' };
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
    const emptyContext = { ...context, idempotencyKey: 'provider-contract-empty-export-0001' };
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
    const original = exportRequest();
    const originalPreview = await provider.previewRosterExport(
      context,
      exportPreviewRequest(original),
    );
    const completed = await provider.exportFinalizedRoster(context, {
      ...original,
      previewId: originalPreview.previewId,
      confirmationToken: originalPreview.confirmationToken,
    });
    const changed = structuredClone(original);
    changed.roster.athletes[0]!.firstName = 'Changed';
    const changedPreview = await provider.previewRosterExport(
      context,
      exportPreviewRequest(changed),
    );
    await expect(
      provider.exportFinalizedRoster(context, {
        ...changed,
        previewId: changedPreview.previewId,
        confirmationToken: changedPreview.confirmationToken,
      }),
    ).rejects.toEqual({ code: 'conflict', retryable: false });
    await expect(provider.getSyncStatus(context, completed.externalJobId)).resolves.toEqual(
      completed,
    );
  });

  it('returns cloned immutable results and never mutates request snapshots', async () => {
    const provider = new MockTheSquadProvider({ fixture: 'success' });
    const request = exportPreviewRequest(exportRequest());
    const before = structuredClone(request);
    const preview = await provider.previewRosterExport(context, request);
    expect(request).toEqual(before);
    expect(Object.isFrozen(preview)).toBe(true);
    expect(Object.isFrozen(preview.items)).toBe(true);
    const second = await provider.previewRosterExport(context, request);
    expect(second).not.toBe(preview);
    expect(second).toEqual(preview);
  });

  it('limits import preview fields to the explicitly approved field set', async () => {
    const provider = new MockTheSquadProvider({ fixture: 'success' });
    const approvedContext = { ...context, idempotencyKey: 'provider-contract-fields-0001' };
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
    await expect(provider.verifyConnection({ ...context, correlationId: 'short' })).rejects.toEqual(
      { code: 'invalid_request', retryable: false },
    );
    await expect(provider.getSyncStatus(context, '\u043c\u043e\u0441k-job')).rejects.toEqual({
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
});
