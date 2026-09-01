import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { RankingsWorkspace } from '../../../src/modules/rankings/ui/rankings-workspace';

describe('rankings workspace', () => {
  it('renders tie and confidence context with accessible filter targets', () => {
    render(
      <RankingsWorkspace
        filters={{ divisionId: 'd', search: 'Athlete' }}
        initial={{
          filterOptions: {
            divisions: [{ id: 'd', name: 'U15' }],
            positions: [{ id: 'p', name: 'Goalie' }],
            sessions: [{ id: 's', name: 'Skills' }],
            groups: [{ id: 'g', name: 'Blue' }],
          },
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
    expect(screen.getByRole('status')).toHaveTextContent(
      '1 athletes · current authorized snapshot',
    );
    expect(screen.getByText(/evaluations complete/)).toHaveTextContent(
      '2 of 3 evaluations complete',
    );
    expect(screen.getByTestId('ranking-card-r')).toHaveClass('ranking-card');
    expect(screen.getByTestId('ranking-rank-r')).toHaveTextContent('Rank 1');
    expect(screen.getByTestId('ranking-score-r')).toHaveTextContent('84.0');
    expect(screen.getByText('Confidence evidence')).toBeInTheDocument();
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
    expect(screen.getByRole('link', { name: /compare selected/i })).toHaveAttribute(
      'href',
      './compare?athletes=',
    );
  });

  it('never presents missing scores as zero', () => {
    render(
      <RankingsWorkspace
        initial={{
          filterOptions: { divisions: [], positions: [], sessions: [], groups: [] },
          rows: [
            {
              athleteId: 'a',
              registrationId: 'r',
              displayName: 'Athlete 9',
              tryoutNumber: 9,
              divisionId: 'd',
              divisionName: 'U15',
              positionId: null,
              positionName: null,
              rank: null,
              isTied: false,
              overall: null,
              priorityCategoryId: null,
              priorityCategoryOverall: null,
              completedEvaluators: 0,
              expectedEvaluators: 3,
              completionPercent: 0,
              scoreRange: null,
              categories: [],
              sessions: [],
              groups: [],
              flags: [],
            },
          ],
          page: 1,
          pageSize: 25,
          total: 1,
          totalPages: 1,
          generatedAt: '2026-08-29T12:00:00.000Z',
        }}
      />,
    );
    expect(screen.getByTestId('ranking-score-r')).toHaveTextContent('Unranked');
    expect(screen.getByTestId('ranking-score-r')).not.toHaveTextContent('0');
  });

  it('keeps independently authorized filters and reset action visible with zero rows', () => {
    render(
      <RankingsWorkspace
        filters={{ positionId: 'p', search: 'missing' }}
        initial={{
          filterOptions: {
            divisions: [{ id: 'd', name: 'U15' }],
            positions: [{ id: 'p', name: 'Goalie' }],
            sessions: [{ id: 's', name: 'Skills' }],
            groups: [{ id: 'g', name: 'Blue' }],
          },
          rows: [],
          page: 1,
          pageSize: 25,
          total: 0,
          totalPages: 1,
          generatedAt: '2026-08-29T12:00:00.000Z',
        }}
      />,
    );
    expect(screen.getByLabelText('Position')).toHaveValue('p');
    expect(screen.getByRole('option', { name: 'Goalie' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Clear filters' })).toHaveAttribute(
      'href',
      '?pageSize=25',
    );
    expect(screen.getByText('No ranking evidence yet')).toBeInTheDocument();
  });
});
