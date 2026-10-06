import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/modules/tryouts/application/duplicate-tryout-action', () => ({
  duplicateTryoutAction: vi.fn(),
}));

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
    expect(screen.getByText('Manage registration and tryout operations')).toBeVisible();
  });
  it.each(['draft', 'published', 'finalized'] as const)(
    'allows authorized management for a %s tryout',
    (status) => {
      render(
        <TryoutCard
          baseHref="/app/club/tryouts/source"
          name="Camp"
          status={status}
          updatedAt="2026-09-12T00:00:00Z"
          management={{ organizationSlug: 'club', tryoutId: 'source' }}
        />,
      );
      expect(screen.getByRole('link', { name: 'Edit setup' })).toHaveAttribute(
        'href',
        '/app/club/tryouts/source/setup/basics',
      );
      expect(screen.getByRole('button', { name: 'Duplicate tryout' })).toBeEnabled();
    },
  );

  it('hides management actions without authorization', () => {
    render(
      <TryoutCard
        baseHref="/app/club/tryouts/source"
        name="Camp"
        status="finalized"
        updatedAt="2026-09-12T00:00:00Z"
      />,
    );
    expect(screen.queryByRole('link', { name: 'Edit setup' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Duplicate tryout' })).not.toBeInTheDocument();
  });
});
