import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { TryoutWizard } from '../../../src/modules/tryouts/ui/tryout-wizard';

const basics = {
  name: 'U15 Fall Evaluations',
  sport: 'Hockey',
  timezone: 'America/Edmonton',
  registrationStartsAt: '2026-09-10T09:00',
  registrationEndsAt: '2026-09-30T18:30',
};

describe('tryout wizard basics', () => {
  it('renders the persisted basics instead of replacing them with blank fields', () => {
    render(
      <TryoutWizard
        action={vi.fn()}
        basics={basics}
        blockers={[]}
        name={basics.name}
        step="basics"
      />,
    );

    expect(screen.getByRole('textbox', { name: /tryout name/i })).toHaveValue(basics.name);
    expect(screen.getByRole('textbox', { name: /sport/i })).toHaveValue('Hockey');
    expect(screen.getByRole('textbox', { name: /timezone/i })).toHaveValue('America/Edmonton');
    expect(screen.getByLabelText(/registration opens/i)).toHaveValue('2026-09-10T09:00');
    expect(screen.getByLabelText(/registration closes/i)).toHaveValue('2026-09-30T18:30');
  });

  it('explains an invalid basics submission with an actionable message', () => {
    render(
      <TryoutWizard
        action={vi.fn()}
        basics={basics}
        blockers={[]}
        error="invalid_input"
        name={basics.name}
        step="basics"
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Check the highlighted fields. Sport and timezone are required, and registration must close after it opens.',
    );
    expect(screen.getByText('All fields are required.')).toBeVisible();
  });
});
