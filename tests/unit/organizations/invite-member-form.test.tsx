import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { InviteMemberForm } from '../../../src/modules/organizations/components/invite-member-form';

describe('InviteMemberForm', () => {
  it('renders an explicit one-time sharing confirmation when email delivery is unavailable', async () => {
    const action = vi.fn(async () => ({
      status: 'manual_share' as const,
      shareUrl: '/invite/one-time-token',
    }));
    const user = userEvent.setup();

    render(<InviteMemberForm action={action} />);
    await user.type(screen.getByLabelText('Email'), 'coach@example.com');
    await user.click(screen.getByRole('button', { name: 'Create invitation' }));

    expect(await screen.findByRole('heading', { name: 'Invitation created' })).toBeVisible();
    expect(screen.getByLabelText('One-time invitation link')).toHaveValue('/invite/one-time-token');
    expect(screen.getByText(/email delivery is not configured yet/i)).toBeVisible();
  });
});
