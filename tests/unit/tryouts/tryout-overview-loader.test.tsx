import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const organizationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const actorId = '11111111-1111-4111-8111-111111111111';
const tryoutId = '22222222-2222-4222-8222-222222222222';

const mocks = vi.hoisted(() => ({
  loadTryoutJourney: vi.fn(),
  captureOperationalError: vi.fn(),
  trackSupabaseWorkflowSafely: vi.fn(),
  TryoutJourneyLoadError: class TryoutJourneyLoadError extends Error {
    constructor(public readonly code: string) {
      super(`Tryout journey ${code}`);
    }
  },
}));

vi.mock('server-only', () => ({}));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));
vi.mock('../../../src/modules/organizations/application/require-capability', () => ({
  requireCapability: () => ({ ok: true }),
}));
vi.mock('../../../src/modules/organizations/application/organization-route-context', () => ({
  requireOrganizationRouteContext: async () => {
    return {
      authorization: {},
      client: {},
      organization: { id: organizationId, name: 'Org', slug: 'org' },
      userId: actorId,
    };
  },
}));
vi.mock('../../../src/modules/tryouts/application/load-tryout-journey', () => ({
  loadTryoutJourney: mocks.loadTryoutJourney,
  TryoutJourneyLoadError: mocks.TryoutJourneyLoadError,
}));
vi.mock('../../../src/infrastructure/observability/server-observability', () => ({
  captureOperationalError: mocks.captureOperationalError,
}));
vi.mock('../../../src/infrastructure/analytics/supabase-analytics-provider', () => ({
  trackSupabaseWorkflowSafely: mocks.trackSupabaseWorkflowSafely,
}));
vi.mock('../../../src/lib/env', () => ({
  getPublicAppOrigin: () => 'https://tryoutflow.example',
}));

import TryoutOverviewPage from '../../../src/app/(app)/app/[organizationSlug]/tryouts/[tryoutId]/overview/page';

function renderPage() {
  return TryoutOverviewPage({
    params: Promise.resolve({ organizationSlug: 'org', tryoutId }),
    searchParams: Promise.resolve({}),
  } as never).then((page) => render(page));
}

describe('tryout overview loader outcomes', () => {
  beforeEach(() => {
    mocks.loadTryoutJourney.mockReset();
    mocks.captureOperationalError.mockReset();
    mocks.trackSupabaseWorkflowSafely.mockReset();
    mocks.trackSupabaseWorkflowSafely.mockResolvedValue(undefined);
  });

  it('preserves the non-oracular 404 for an actually absent or forbidden row', async () => {
    mocks.loadTryoutJourney.mockRejectedValueOnce(new mocks.TryoutJourneyLoadError('not_found'));
    await expect(renderPage()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(mocks.captureOperationalError).not.toHaveBeenCalled();
  });

  it('renders retryable unavailable and records closed evidence for a query error', async () => {
    mocks.loadTryoutJourney.mockRejectedValueOnce(
      new Error('guardian@example.test raw-score=4 provider-token=secret'),
    );

    await renderPage();

    expect(
      screen.getByRole('heading', { name: 'Tryout temporarily unavailable' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Retry' })).toHaveAttribute(
      'href',
      `/app/org/tryouts/${tryoutId}/overview`,
    );
    expect(document.body.textContent).not.toMatch(/guardian|raw-score|provider-token|secret/iu);
    expect(mocks.captureOperationalError).toHaveBeenCalledWith(expect.any(Error), {
      actorId,
      organizationId,
      tryoutId,
      operation: 'tryouts.load',
    });
    expect(mocks.trackSupabaseWorkflowSafely).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        name: 'workflow.failed',
        workflow: 'tryout_setup',
        organizationId,
      }),
    );
  });

  it('treats an unavailable journey projection as retryable instead of rendering or returning 404', async () => {
    mocks.loadTryoutJourney.mockRejectedValueOnce(new mocks.TryoutJourneyLoadError('unavailable'));

    await renderPage();

    expect(
      screen.getByRole('heading', { name: 'Tryout temporarily unavailable' }),
    ).toBeInTheDocument();
    expect(mocks.captureOperationalError).toHaveBeenCalledTimes(1);
  });
});
