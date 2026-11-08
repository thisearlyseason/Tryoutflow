import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { StartOrganizationForm } from '@/modules/organizations/ui/start-organization-form';

describe('organization setup form', () => {
  it('suggests an editable address and respects a deliberate override', async () => {
    render(<StartOrganizationForm action={vi.fn()} />);
    const name = screen.getByRole('textbox', { name: 'Organization name' });
    const address = screen.getByRole('textbox', { name: 'Your TryoutFlow workspace address' });
    await userEvent.type(name, 'Café Club');
    expect(address).toHaveValue('cafe-club');
    await userEvent.clear(address);
    await userEvent.type(address, 'our-club');
    await userEvent.type(name, ' North');
    expect(address).toHaveValue('our-club');
  });
  it('preserves entries and focuses a useful conflict message instead of resetting the form', async () => {
    const action = vi.fn().mockResolvedValue({
      status: 'error',
      message: 'Choose another workspace address.',
      fieldErrors: { slug: 'That workspace address is already in use.' },
    });
    render(<StartOrganizationForm action={action} />);
    await userEvent.type(screen.getByRole('textbox', { name: 'Organization name' }), 'My Club');
    const timezone = screen.getByRole('combobox', { name: 'Timezone' });
    await userEvent.clear(timezone);
    await userEvent.type(timezone, 'America/Edmonton');
    await userEvent.click(screen.getByRole('button', { name: 'Create organization' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Choose another workspace address.');
    expect(screen.getByRole('textbox', { name: 'Organization name' })).toHaveValue('My Club');
    expect(screen.getByRole('textbox', { name: 'Your TryoutFlow workspace address' })).toHaveValue(
      'my-club',
    );
    expect(timezone).toHaveValue('America/Edmonton');
    expect(screen.getByRole('alert')).toHaveFocus();
  });
});

it('prefills a valid device timezone even when it is an alias absent from the search catalog', () => {
  const resolved = new Intl.DateTimeFormat().resolvedOptions();
  const spy = vi
    .spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions')
    .mockReturnValue({ ...resolved, timeZone: 'UTC' });
  try {
    render(<StartOrganizationForm action={vi.fn()} />);
    expect(screen.getByRole('combobox', { name: 'Timezone' })).toHaveValue('UTC');
  } finally {
    spy.mockRestore();
  }
});
