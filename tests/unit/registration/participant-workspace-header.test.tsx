import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ParticipantWorkspaceHeader } from '../../../src/modules/registration/ui/participant-workspace-header';

describe('participant workspace header', () => {
  it('puts new, returning, public, and import participant paths in one place', () => {
    render(
      <ParticipantWorkspaceHeader
        importHref="/app/badlands/athletes/import"
        overviewHref="/app/badlands/tryouts/tryout-1/overview#registration-share"
        participantCount={7}
        tryoutName="U15 Fall Evaluations"
      />,
    );

    expect(
      screen.getByRole('heading', { name: 'U15 Fall Evaluations participants' }),
    ).toBeVisible();
    expect(screen.getByText('7 registered')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Add a new participant' })).toHaveAttribute(
      'href',
      '#add-participant',
    );
    expect(screen.getByRole('link', { name: 'Find a returning athlete' })).toHaveAttribute(
      'href',
      '#returning-participant',
    );
    expect(screen.getByRole('link', { name: 'Share registration link' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Import CSV' })).toBeVisible();
  });
});
