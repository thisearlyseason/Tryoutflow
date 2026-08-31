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
      sourceDigest: 'b'.repeat(64),
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
    const confirm = vi.fn().mockResolvedValue({
      outcome: 'replayed',
      jobId: '10000000-0000-4000-8000-000000000001',
      state: 'needs_attention',
      completedCount: 1,
      skippedCount: 0,
      failedCount: 1,
      retryEligibleCount: 0,
    });
    const retry = vi.fn().mockResolvedValue({
      outcome: 'queued',
      jobId: '10000000-0000-4000-8000-000000000001',
      state: 'processing',
      retriedItemCount: 1,
      preservedCompletedItemCount: 1,
      preservedSkippedItemCount: 2,
      completedCount: 7,
      skippedCount: 2,
      failedCount: 3,
      retryEligibleCount: 1,
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
          retryEligibleCount: 1,
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
    expect(screen.getByRole('status')).toHaveTextContent(/processing/i);
    expect(screen.getByRole('status')).toHaveTextContent(
      /7 completed · 2 skipped · 3 failed\/reviewable/i,
    );
    expect(screen.getByRole('button', { name: /retry 1 failed item/i })).toBeVisible();
    await user.click(screen.getByLabelText(/i reviewed the exact destination and fields/i));
    await user.click(screen.getByRole('button', { name: /confirm and queue export/i }));
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        previewId: 'preview:task27:00000001',
        sourceDigest: 'b'.repeat(64),
      }),
    );
    expect(screen.getByRole('status')).toHaveTextContent(/needs attention/i);
    expect(screen.getByText(/delivery is uncertain/i)).toBeVisible();
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
          sourceDigest: 'b'.repeat(64),
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
          retryEligibleCount: 0,
        })}
        onRetry={async () => ({ outcome: 'unavailable' })}
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

  it('does not offer ordinary retry for an ambiguous review item', () => {
    render(
      <RosterExportWizard
        rosterVersionId="10000000-0000-4000-8000-000000000002"
        destinations={[destination]}
        onPreview={async () => ({ outcome: 'unavailable' })}
        onConfirm={async () => ({ outcome: 'conflict' })}
        onRetry={async () => ({ outcome: 'unavailable' })}
        initialJob={{
          id: '10000000-0000-4000-8000-000000000001',
          state: 'failed',
          completedCount: 0,
          skippedCount: 0,
          failedCount: 1,
          retryEligibleCount: 0,
        }}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent(/failed/i);
    expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument();
  });

  it.each([
    {
      outcome: 'replayed',
      state: 'processing',
      completedCount: 7,
      skippedCount: 2,
      failedCount: 1,
      retryEligibleCount: 0,
      message: /retry queued for failed or reviewable items only/i,
    },
    {
      outcome: 'nothing_to_retry',
      state: 'completed',
      completedCount: 8,
      skippedCount: 2,
      failedCount: 0,
      retryEligibleCount: 0,
      message: /no retryable items were changed/i,
    },
    {
      outcome: 'manual_attention_required',
      state: 'needs_attention',
      completedCount: 6,
      skippedCount: 1,
      failedCount: 2,
      retryEligibleCount: 0,
      message: /manual attention is required/i,
    },
  ] as const)('replaces stale retry UI from the $outcome durable projection', async (durable) => {
    const user = userEvent.setup();
    render(
      <RosterExportWizard
        rosterVersionId="10000000-0000-4000-8000-000000000002"
        destinations={[destination]}
        onPreview={async () => ({ outcome: 'unavailable' })}
        onConfirm={async () => ({ outcome: 'conflict' })}
        onRetry={async () => ({
          ...durable,
          jobId: '10000000-0000-4000-8000-000000000001',
          retriedItemCount: durable.outcome === 'replayed' ? 1 : 0,
          preservedCompletedItemCount: durable.completedCount,
          preservedSkippedItemCount: durable.skippedCount,
        })}
        initialJob={{
          id: '10000000-0000-4000-8000-000000000001',
          state: 'partially_completed',
          completedCount: 1,
          skippedCount: 0,
          failedCount: 4,
          retryEligibleCount: 1,
        }}
      />,
    );

    await user.click(screen.getByRole('button', { name: /retry 1 failed item/i }));
    expect(screen.getByRole('status')).toHaveTextContent(
      `${durable.completedCount} completed · ${durable.skippedCount} skipped · ${durable.failedCount} failed/reviewable`,
    );
    expect(screen.getByRole('status')).toHaveTextContent(durable.state.replaceAll('_', ' '));
    expect(screen.getAllByText(durable.message).at(-1)).toBeVisible();
    expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument();
  });

  it('fails closed instead of retaining a stale retry action for a malformed job-bound result', async () => {
    const user = userEvent.setup();
    render(
      <RosterExportWizard
        rosterVersionId="10000000-0000-4000-8000-000000000002"
        destinations={[destination]}
        onPreview={async () => ({ outcome: 'unavailable' })}
        onConfirm={async () => ({ outcome: 'conflict' })}
        onRetry={async () => ({ outcome: 'nothing_to_retry' }) as never}
        initialJob={{
          id: '10000000-0000-4000-8000-000000000001',
          state: 'partially_completed',
          completedCount: 1,
          skippedCount: 0,
          failedCount: 4,
          retryEligibleCount: 1,
        }}
      />,
    );

    await user.click(screen.getByRole('button', { name: /retry 1 failed item/i }));
    expect(screen.getByText(/durable retry returned an invalid projection/i)).toBeVisible();
    expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument();
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
        onRetry={async () => ({ outcome: 'unavailable' })}
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
