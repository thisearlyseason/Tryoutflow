'use client';

import { RosterExportWizard } from '../../../../src/modules/integrations/ui/roster-export-wizard';

const destination = {
  organization: {
    providerKey: 'the-squad',
    entityType: 'organization' as const,
    externalId: 'mock-org',
    displayName: 'Mock org',
    mockData: true,
  },
  season: {
    providerKey: 'the-squad',
    entityType: 'season' as const,
    externalId: 'mock-season',
    displayName: 'Mock season',
    mockData: true,
  },
  division: {
    providerKey: 'the-squad',
    entityType: 'division' as const,
    externalId: 'mock-division',
    displayName: 'Mock division',
    mockData: true,
  },
  team: {
    providerKey: 'the-squad',
    entityType: 'team' as const,
    externalId: 'mock-team',
    displayName: 'Mock team',
    mockData: true,
  },
  displayLabel: 'Mock season / Mock division / Mock team',
  mockData: true,
};

export default function Page() {
  return (
    <RosterExportWizard
      rosterVersionId="10000000-0000-4000-8000-000000000002"
      destinations={[destination]}
      onPreview={async () => ({
        outcome: 'previewed',
        previewId: 'preview:task27:00000001',
        confirmationToken: 'confirmation:task27:00000001',
        snapshotDigest: 'a'.repeat(64),
        totalItems: 2,
        mockData: true,
        items: [
          {
            itemKey: 'athlete:20000000-0000-4000-8000-000000000001',
            registrationId: '20000000-0000-4000-8000-000000000001',
            operation: 'create',
            displayLabel: 'Synthetic Athlete One',
            fields: { firstName: 'Synthetic', lastName: 'Athlete One', teamName: 'Blue' },
          },
          {
            itemKey: 'athlete:20000000-0000-4000-8000-000000000002',
            registrationId: '20000000-0000-4000-8000-000000000002',
            operation: 'create',
            displayLabel: 'Synthetic Athlete Two',
            fields: { firstName: 'Synthetic', lastName: 'Athlete Two', teamName: 'Blue' },
          },
        ],
      })}
      onConfirm={async () => ({ outcome: 'queued', jobId: '10000000-0000-4000-8000-000000000001' })}
      onRetry={async () => ({ outcome: 'queued', jobId: '10000000-0000-4000-8000-000000000001' })}
      initialJob={{
        id: '10000000-0000-4000-8000-000000000001',
        state: 'partially_completed',
        completedCount: 1,
        failedCount: 1,
      }}
    />
  );
}
