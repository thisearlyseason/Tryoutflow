import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

  it('associates returned field errors and preserves bounded submitted values', async () => {
    const user = userEvent.setup();
    render(
      <TryoutWizard
        action={vi.fn(async () => ({
          status: 'field_error' as const,
          fieldErrors: {
            sport: 'Enter a sport.',
            registrationEndsAt: 'Registration must close after it opens.',
          },
          values: {
            ...basics,
            registrationEndsAt: '2026-09-01T09:00',
          },
        }))}
        basics={basics}
        blockers={[]}
        name={basics.name}
        step="basics"
      />,
    );

    await user.clear(screen.getByLabelText(/registration closes/i));
    await user.type(screen.getByLabelText(/registration closes/i), '2026-09-01T09:00');
    await user.click(screen.getByRole('button', { name: 'Save and continue' }));

    const sport = screen.getByRole('textbox', { name: /sport/i });
    const closes = screen.getByLabelText(/registration closes/i);
    expect(await screen.findByText('Enter a sport.')).toHaveAttribute(
      'id',
      'tryout-basics-sport-error',
    );
    expect(sport).toHaveAttribute('aria-invalid', 'true');
    expect(sport).toHaveAttribute('aria-describedby', 'tryout-basics-sport-error');
    expect(closes).toHaveValue('2026-09-01T09:00');
    expect(closes).toHaveAttribute('aria-invalid', 'true');
    expect(closes).toHaveAttribute(
      'aria-describedby',
      'tryout-basics-closes-help tryout-basics-closes-error',
    );
  });
});
