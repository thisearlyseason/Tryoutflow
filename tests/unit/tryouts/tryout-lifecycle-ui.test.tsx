import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { TryoutLifecycle } from '../../../src/modules/tryouts/ui/tryout-lifecycle';

describe('tryout lifecycle', () => {
  it('shows exact authorized stages and does not infer completion from the current stage', () => {
    render(
      <TryoutLifecycle
        completed={['draft', 'published', 'registration']}
        current="evaluation"
        hrefs={{
          draft: '/setup',
          published: '/overview',
          registration: '/registration',
          evaluation: '/live',
          decisions: '/rankings',
          finalized: '/rosters',
        }}
      />,
    );

    expect(screen.getByRole('list', { name: 'Tryout lifecycle' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Evaluation' })).toHaveAttribute(
      'aria-current',
      'step',
    );
    expect(screen.getByRole('link', { name: 'Registration' })).toHaveAttribute(
      'data-complete',
      'true',
    );
    expect(screen.getByRole('link', { name: 'Finalized' })).not.toHaveAttribute(
      'data-complete',
      'true',
    );
  });

  it('omits unauthorized destinations rather than rendering disabled links', () => {
    render(<TryoutLifecycle current="evaluation" hrefs={{ evaluation: '/evaluate' }} />);

    expect(screen.getByRole('link', { name: 'Evaluation' })).toBeVisible();
    expect(screen.queryByText('Decisions')).not.toBeInTheDocument();
  });
});
