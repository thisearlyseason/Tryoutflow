import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AssignedSessionWorkspace } from '../../../src/modules/evaluations/ui/assigned-session-workspace';

describe('direct assigned-session entry', () => {
  it('shows assigned athletes directly and retains completion and alternate-view destinations', () => {
    const basePath = '/app/fictional/evaluate/session/fictional-session';
    render(
      <AssignedSessionWorkspace
        sessionName="Fictional morning session"
        basePath={basePath}
        athletes={[
          {
            registrationId: 'fictional-athlete',
            divisionId: 'division',
            sessionId: 'session',
            groupId: null,
            displayName: 'Fictional Athlete',
            divisionName: 'U14',
            sessionName: 'Morning',
            groupName: null,
            tryoutNumber: 12,
            identityMode: 'full',
          },
        ]}
        evaluations={[
          {
            id: 'fictional-evaluation',
            registrationId: 'fictional-athlete',
            rubricVersionId: 'rubric',
            state: 'draft',
            version: 1,
          },
        ]}
      />,
    );
    expect(
      screen.getByRole('heading', { level: 1, name: 'Fictional morning session' }),
    ).toBeVisible();
    expect(screen.getByRole('link', { name: 'Open evaluation' })).toHaveAttribute(
      'href',
      `${basePath}/athletes/fictional-athlete`,
    );
    expect(screen.getByText(/0 of 1 evaluations confirmed complete/)).toBeVisible();
    expect(screen.getByRole('link', { name: 'Your progress' })).toHaveAttribute(
      'href',
      `${basePath}/progress`,
    );
    expect(
      screen.getByRole('link', { name: 'Search athletes or score by station' }),
    ).toHaveAttribute('href', `${basePath}/athletes`);
  });
});
