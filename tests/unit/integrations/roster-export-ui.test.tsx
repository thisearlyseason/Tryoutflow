import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { IntegrationCard } from '../../../src/modules/integrations/ui/integration-card';
import { RosterExportWizard } from '../../../src/modules/integrations/ui/roster-export-wizard';
import { RosterExportLink } from '../../../src/modules/integrations/ui/roster-export-link';

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

describe('integration export UI', () => {
  it('provides a discoverable export link for an authorized finalized roster', () => {
    render(
      <RosterExportLink
        href="/app/badlands/tryouts/100/rosters/200/export"
        rosterState="finalized"
        authorized
      />,
    );
    expect(screen.getByRole('link', { name: /export finalized roster/i })).toBeVisible();
  });
  it('labels The Squad as disabled demo/mock and never implies a live connection', () => {
    render(<IntegrationCard enabled={false} providerName="The Squad (demo/mock)" />);
    expect(screen.getAllByText(/demo\/mock/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/disabled by default/i)).toBeVisible();
    expect(screen.queryByText(/live transfer/i)).not.toBeInTheDocument();
  });

  it('renders explicit connection failures instead of swallowing them', () => {
    render(
      <IntegrationCard
        enabled
        providerName="The Squad (demo/mock)"
        notice="The demo connection could not be completed. Try again."
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent(/could not be completed/i);
  });

  it('requires destination and approved-field review before exact confirmation, then exposes retry', async () => {
    const user = userEvent.setup();
    const preview = vi.fn().mockResolvedValue({
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
          displayLabel: 'Synthetic One',
          fields: { firstName: 'Synthetic', lastName: 'One' },
        },
        {
          itemKey: 'athlete:20000000-0000-4000-8000-000000000002',
          registrationId: '20000000-0000-4000-8000-000000000002',
          operation: 'create',
          displayLabel: 'Synthetic Two',
          fields: { firstName: 'Synthetic', lastName: 'Two' },
        },
      ],
    });
    const confirm = vi
      .fn()
      .mockResolvedValue({ outcome: 'queued', jobId: '10000000-0000-4000-8000-000000000001' });
    const retry = vi.fn().mockResolvedValue({
      outcome: 'queued',
      jobId: '10000000-0000-4000-8000-000000000001',
      retriedItemCount: 1,
      preservedCompletedItemCount: 1,
    });
    render(
      <RosterExportWizard
        rosterVersionId="10000000-0000-4000-8000-000000000002"
        destinations={[destination]}
        onPreview={preview}
        onConfirm={confirm}
        onRetry={retry}
        initialJob={{
          id: '10000000-0000-4000-8000-000000000001',
          state: 'partially_completed',
          completedCount: 1,
          skippedCount: 0,
          failedCount: 1,
        }}
      />,
    );

    expect(screen.getByRole('button', { name: /preview export/i })).toBeDisabled();
    await user.selectOptions(
      screen.getByLabelText(/external destination/i),
      destination.team.externalId,
    );
    await user.click(screen.getByLabelText('First name'));
    await user.click(screen.getByLabelText('Last name'));
    await user.click(screen.getByRole('button', { name: /preview export/i }));
    expect(await screen.findByRole('heading', { name: /review 2 athletes/i })).toBeVisible();
    expect(screen.getByText(/only the approved fields/i)).toBeVisible();
    expect(screen.getAllByText('Synthetic', { selector: 'dd' })).toHaveLength(2);
    expect(screen.getByText('One', { selector: 'dd' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: /retry 1 failed item/i }));
    expect(retry).toHaveBeenCalledWith('10000000-0000-4000-8000-000000000001');
    await user.click(screen.getByLabelText(/i reviewed the exact destination and fields/i));
    await user.click(screen.getByRole('button', { name: /confirm and queue export/i }));
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({ previewId: 'preview:task27:00000001' }),
    );
    expect(screen.getByRole('status')).toHaveTextContent(/pending/i);
  });

  it('shows a newly confirmed empty export as completed with no transfer', async () => {
    const user = userEvent.setup();
    render(
      <RosterExportWizard
        rosterVersionId="10000000-0000-4000-8000-000000000002"
        destinations={[destination]}
        onPreview={async () => ({
          outcome: 'previewed',
          previewId: 'preview:task27:empty:0001',
          confirmationToken: 'confirmation:task27:empty:0001',
          snapshotDigest: 'a'.repeat(64),
          totalItems: 0,
          mockData: true,
          items: [],
        })}
        onConfirm={async () => ({
          outcome: 'completed',
          jobId: '10000000-0000-4000-8000-000000000001',
          state: 'completed',
          completedCount: 0,
          skippedCount: 0,
          failedCount: 0,
        })}
        onRetry={async () => ({ outcome: 'nothing_to_retry' })}
      />,
    );
    await user.selectOptions(
      screen.getByLabelText(/external destination/i),
      destination.team.externalId,
    );
    await user.click(screen.getByLabelText('First name'));
    await user.click(screen.getByRole('button', { name: /preview export/i }));
    await user.click(screen.getByLabelText(/i reviewed the exact destination and fields/i));
    await user.click(screen.getByRole('button', { name: /confirm and queue export/i }));
    expect(await screen.findByText(/completed with no transfer/i)).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent(
      /0 completed · 0 skipped · 0 failed\/reviewable · completed/i,
    );
  });

  it('renders an explicit preview error when the server action is unavailable', async () => {
    const user = userEvent.setup();
    render(
      <RosterExportWizard
        rosterVersionId="10000000-0000-4000-8000-000000000002"
        destinations={[destination]}
        onPreview={async () => {
          throw new Error('private provider failure');
        }}
        onConfirm={async () => ({ outcome: 'conflict' })}
        onRetry={async () => ({ outcome: 'nothing_to_retry' })}
      />,
    );
    await user.selectOptions(
      screen.getByLabelText(/external destination/i),
      destination.team.externalId,
    );
    await user.click(screen.getByLabelText('First name'));
    await user.click(screen.getByRole('button', { name: /preview export/i }));
    expect(await screen.findByText(/preview could not be created/i)).toBeVisible();
    expect(screen.queryByText(/private provider failure/i)).not.toBeInTheDocument();
  });
});
