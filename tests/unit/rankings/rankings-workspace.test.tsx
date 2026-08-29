import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { RankingsWorkspace } from '../../../src/modules/rankings/ui/rankings-workspace';

describe('rankings workspace', () => {
  it('renders tie and confidence context with accessible filter targets', () => {
    render(
      <RankingsWorkspace
        filters={{ divisionId: 'd', search: 'Athlete' }}
        initial={{
          rows: [
            {
              athleteId: 'a',
              registrationId: 'r',
              displayName: 'Athlete 12',
              tryoutNumber: 12,
              divisionId: 'd',
              divisionName: 'U15',
              positionId: null,
              positionName: null,
              rank: 1,
              isTied: true,
              overall: '84.0',
              priorityCategoryId: null,
              priorityCategoryOverall: null,
              completedEvaluators: 2,
              expectedEvaluators: 3,
              completionPercent: 67,
              scoreRange: ['82.0', '86.0'],
              categories: [],
              sessions: [],
              groups: [],
              flags: [],
            },
          ],
          page: 1,
          pageSize: 25,
          total: 1,
          totalPages: 2,
          generatedAt: '2026-08-29T12:00:00.000Z',
        }}
      />,
    );
    expect(screen.getByText('Tied at rank 1')).toBeInTheDocument();
    expect(screen.getByText(/evaluations complete/)).toHaveTextContent(
      '2 of 3 evaluations complete',
    );
    expect(screen.getByLabelText('Search athletes')).toHaveClass('min-h-11');
    expect(screen.getByLabelText('Search athletes')).toHaveValue('Athlete');
    expect(screen.getByLabelText('Division')).toHaveValue('d');
    expect(screen.getByRole('link', { name: 'Next page' })).toHaveAttribute(
      'href',
      expect.stringContaining('page=2'),
    );
    expect(screen.getByRole('link', { name: /compare selected/i })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });
});
