import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { InviteMemberForm } from '../../../src/modules/organizations/components/invite-member-form';

describe('InviteMemberForm', () => {
  it('renders an explicit one-time sharing confirmation when email delivery is unavailable', async () => {
    const action = vi.fn(async () => ({
      status: 'manual_share' as const,
      shareUrl: 'https://tryoutflow.example/invite/one-time-token',
      expiresAt: '2026-09-05T12:00:00.000Z',
    }));
    const user = userEvent.setup();

    render(<InviteMemberForm action={action} />);
    expect(screen.getByTestId('invite-member-form')).toHaveClass('admin-form');
    expect(screen.getByLabelText('Email')).toHaveClass('min-h-11');
    await user.type(screen.getByLabelText('Email'), 'coach@example.com');
    await user.click(screen.getByRole('button', { name: 'Create invitation' }));

    expect(await screen.findByRole('heading', { name: 'Invitation created' })).toBeVisible();
    expect(screen.getByLabelText('One-time invitation link')).toHaveValue(
      'https://tryoutflow.example/invite/one-time-token',
    );
    expect(screen.getByText(/September 5, 2026/i)).toBeVisible();
    expect(screen.getByText(/email delivery is not configured yet/i)).toBeVisible();
  });
});
