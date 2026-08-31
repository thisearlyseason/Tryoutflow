import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ReportsPage } from '../../../src/modules/reports/ui/reports-page';

describe('reports page', () => {
  it('shows a truthful empty state and bounded export help', () => {
    render(
      <ReportsPage
        organizationId="29000000-0000-4000-8000-000000000001"
        summary={{
          athleteCount: 0,
          completedEvaluationCount: 0,
          incompleteEvaluationCount: 0,
          finalizedRosterCount: 0,
          latestFinalizedRosterId: null,
        }}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Reports' })).toBeInTheDocument();
    expect(screen.getByText(/no report data yet/i)).toBeInTheDocument();
    expect(screen.getByText(/5,000 rows and 4 MiB/i)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /roster CSV/i })).not.toBeInTheDocument();
  });

  it('offers tryout-scoped sanitized exports and the exact finalized roster snapshot', () => {
    render(
      <ReportsPage
        organizationId="29000000-0000-4000-8000-000000000001"
        tryoutId="29000000-0000-4000-8000-000000000002"
        summary={{
          athleteCount: 8,
          completedEvaluationCount: 12,
          incompleteEvaluationCount: 3,
          finalizedRosterCount: 1,
          latestFinalizedRosterId: '29000000-0000-4000-8000-000000000003',
        }}
      />,
    );
    expect(screen.getByText('8 athletes')).toBeInTheDocument();
    expect(screen.getByText('12 completed evaluations')).toBeInTheDocument();
    expect(screen.getByText('3 incomplete evaluations')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /athletes CSV/i })).toHaveAttribute(
      'href',
      expect.stringContaining('tryoutId=29000000-0000-4000-8000-000000000002'),
    );
    expect(screen.getByRole('link', { name: /finalized roster CSV/i })).toHaveAttribute(
      'href',
      expect.stringContaining('rosterVersionId=29000000-0000-4000-8000-000000000003'),
    );
  });

  it('gives a finalized-roster reviewer only the exact approved download affordance', () => {
    render(
      <ReportsPage
        access={{
          kind: 'reviewer_roster',
          rosterVersionId: '29000000-0000-4000-8000-000000000003',
        }}
        organizationId="29000000-0000-4000-8000-000000000001"
        tryoutId="29000000-0000-4000-8000-000000000002"
      />,
    );
    expect(screen.getByRole('link', { name: /finalized roster CSV/i })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /athletes CSV/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /evaluations CSV/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/completed evaluations/i)).not.toBeInTheDocument();
  });
});
