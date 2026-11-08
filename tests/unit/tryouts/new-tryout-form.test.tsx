import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { NewTryoutForm } from '@/modules/tryouts/ui/new-tryout-form';

const props = {
  seasons: [{ id: 'season', name: '2026 season' }],
  defaultSport: 'Hockey',
  timezone: 'America/Edmonton',
  defaultCycleName: '2026 season',
};
describe('new tryout form', () => {
  it('only submits a new cycle name when creating a cycle, preserving the typed choice when switching', async () => {
    render(<NewTryoutForm {...props} action={vi.fn()} />);
    const season = screen.getByRole('combobox', { name: 'Use an existing cycle' });
    expect(screen.queryByRole('textbox', { name: 'New cycle name' })).toBeNull();
    await userEvent.selectOptions(season, '');
    const newName = screen.getByRole('textbox', { name: 'New cycle name' });
    await userEvent.clear(newName);
    await userEvent.type(newName, 'Next season');
    await userEvent.selectOptions(season, 'season');
    expect(
      new FormData(screen.getByRole('textbox', { name: 'Tryout name' }).closest('form')!).get(
        'newSeasonName',
      ),
    ).toBeNull();
    await userEvent.selectOptions(season, '');
    expect(screen.getByRole('textbox', { name: 'New cycle name' })).toHaveValue('Next season');
  });
  it('keeps the draft inputs after a server error and announces recovery', async () => {
    const action = vi.fn().mockResolvedValue({
      status: 'error',
      message: 'That tryout name is already in use.',
      fieldErrors: { name: 'Choose a different name.' },
    });
    render(<NewTryoutForm {...props} action={action} />);
    await userEvent.type(screen.getByRole('textbox', { name: 'Tryout name' }), 'U15 tryout');
    await userEvent.click(screen.getByRole('button', { name: 'Create draft' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That tryout name is already in use.',
    );
    expect(screen.getByRole('textbox', { name: 'Tryout name' })).toHaveValue('U15 tryout');
    expect(screen.getByRole('textbox', { name: 'Sport' })).toHaveValue('Hockey');
    expect(screen.getByRole('textbox', { name: 'Timezone' })).toHaveValue('America/Edmonton');
    expect(screen.getByRole('combobox', { name: 'Use an existing cycle' })).toHaveValue('season');
  });
});
