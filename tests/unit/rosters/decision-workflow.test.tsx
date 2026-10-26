import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DecisionWorkflow } from '../../../src/modules/rosters/ui/decision-workflow';

describe('selection workflow preserves role and sharing boundaries', () => {
  it('gives a finalized-roster reviewer no comparison, scenario or message shortcut', () => {
    render(
      <DecisionWorkflow
        base="/app/local/tryouts/example"
        current="rosters"
        canCompare={false}
        managesEvent={false}
      />,
    );
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Review final roster' })).toHaveAttribute(
      'aria-current',
      'step',
    );
    expect(screen.queryByRole('link', { name: 'Compare evidence' })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: 'Preview decision messages' }),
    ).not.toBeInTheDocument();
  });
  it('keeps organizer selection, finalization and sending visibly separate', () => {
    render(
      <DecisionWorkflow
        base="/app/local/tryouts/example"
        current="scenarios"
        canCompare
        managesEvent
      />,
    );
    expect(screen.getByRole('link', { name: 'Review alternatives' })).toHaveAttribute(
      'aria-current',
      'step',
    );
    expect(screen.getByRole('link', { name: 'Preview decision messages' })).toHaveAttribute(
      'href',
      '/app/local/tryouts/example/messages',
    );
    expect(screen.getByText(/does not finalize a roster or send a message/)).toBeVisible();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
