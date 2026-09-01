import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { TryoutCard } from '../../../src/modules/tryouts/ui/tryout-card';

describe('tryout card', () => {
  it('sends a draft directly to its recommended setup action', () => {
    render(
      <TryoutCard
        baseHref="/app/badlands/tryouts/tryout-1"
        name="U15 Fall Evaluations"
        status="draft"
        updatedAt="2026-09-01T18:00:00.000Z"
      />,
    );

    expect(screen.getByRole('link', { name: 'Continue setup' })).toHaveAttribute(
      'href',
      '/app/badlands/tryouts/tryout-1/setup/basics',
    );
    expect(screen.queryByRole('link', { name: 'Add participants' })).not.toBeInTheDocument();
  });

  it('gives a published tryout direct operational and participant actions', () => {
    render(
      <TryoutCard
        baseHref="/app/badlands/tryouts/tryout-1"
        name="U15 Fall Evaluations"
        status="published"
        updatedAt="2026-09-01T18:00:00.000Z"
      />,
    );

    expect(screen.getByRole('link', { name: 'Open tryout' })).toHaveAttribute(
      'href',
      '/app/badlands/tryouts/tryout-1/overview',
    );
    expect(screen.getByRole('link', { name: 'Add participants' })).toHaveAttribute(
      'href',
      '/app/badlands/tryouts/tryout-1/registration#add-participant',
    );
    expect(screen.getByText('Participant intake is open')).toBeVisible();
  });
});
