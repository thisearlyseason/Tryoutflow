import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { TryoutActionPlan } from '../../../src/modules/tryouts/ui/tryout-action-plan';

describe('tryout action plan', () => {
  it('makes participants and the recommended published action obvious', () => {
    render(
      <TryoutActionPlan
        baseHref="/app/badlands/tryouts/tryout-1"
        participantCount={12}
        status="published"
      />,
    );

    expect(screen.getByRole('heading', { name: 'Participants' })).toBeVisible();
    expect(screen.getByText('12 registered')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Add participant' })).toHaveAttribute(
      'href',
      '/app/badlands/tryouts/tryout-1/registration#add-participant',
    );
    expect(screen.getByRole('link', { name: 'Share registration link' })).toHaveAttribute(
      'href',
      '#registration-share',
    );
    expect(screen.getByText('Recommended next')).toBeVisible();
  });

  it('keeps draft users focused on preparation instead of exposing unavailable intake actions', () => {
    render(
      <TryoutActionPlan
        baseHref="/app/badlands/tryouts/tryout-1"
        participantCount={0}
        status="draft"
      />,
    );

    expect(screen.getByRole('link', { name: 'Continue setup' })).toHaveAttribute(
      'href',
      '/app/badlands/tryouts/tryout-1/setup/basics',
    );
    expect(screen.queryByRole('link', { name: 'Add participant' })).not.toBeInTheDocument();
    expect(screen.getByText('Available after publishing')).toBeVisible();
  });
});
