import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { OrganizationId, UserId } from '../../../src/lib/ids';
import type { AuthorizationContext } from '../../../src/modules/organizations/application/capabilities';
import { assignTryoutNumber } from '../../../src/modules/checkin/application/assign-tryout-number';
import { checkInAthlete } from '../../../src/modules/checkin/application/check-in-athlete';
import { numberScopeKey } from '../../../src/modules/checkin/domain/number-scope';
import { CheckinWorkspace } from '../../../src/modules/checkin/ui/checkin-workspace';

const organizationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' as OrganizationId;
const userId = '11111111-1111-4111-8111-111111111111' as UserId;
const actor: AuthorizationContext = {
  userId,
  organizationId,
  organizationRole: 'member',
  membershipStatus: 'active',
  assignments: [
    {
      role: 'checkin',
      scope: { kind: 'session', tryoutId: 'tryout-1', sessionId: 'session-1' },
    },
  ],
};

describe('check-in commands', () => {
  it('uses explicit, collision-free number scope keys', () => {
    expect(numberScopeKey({ kind: 'tryout', tryoutId: 't' })).toBe('tryout:t');
    expect(numberScopeKey({ kind: 'division', tryoutId: 't', divisionId: 'd' })).toBe(
      'division:t:d',
    );
    expect(numberScopeKey({ kind: 'session', tryoutId: 't', sessionId: 's' })).toBe('session:t:s');
    expect(numberScopeKey({ kind: 'group', tryoutId: 't', sessionId: 's', groupId: 'g' })).toBe(
      'group:t:s:g',
    );
  });

  it('authorizes assignment at the exact operational scope and forwards one atomic request', async () => {
    const gateway = { assign: vi.fn(async () => ({ outcome: 'assigned' as const, number: 42 })) };
    const result = await assignTryoutNumber(
      {
        organizationId,
        tryoutId: 'tryout-1',
        registrationId: 'registration-1',
        divisionId: 'division-1',
        sessionId: 'session-1',
        scope: { kind: 'division', tryoutId: 'tryout-1', divisionId: 'division-1' },
        requested: 42,
      },
      actor,
      gateway,
    );
    expect(result).toEqual({ outcome: 'assigned', number: 42 });
    expect(gateway.assign).toHaveBeenCalledTimes(1);
  });

  it('denies a different session before touching persistence', async () => {
    const gateway = { checkIn: vi.fn() };
    await expect(
      checkInAthlete(
        {
          organizationId,
          tryoutId: 'tryout-1',
          registrationId: 'registration-1',
          divisionId: 'division-1',
          sessionId: 'session-2',
          idempotencyKey: 'checkin-request-1234567890123456',
        },
        actor,
        gateway,
      ),
    ).rejects.toEqual({ code: 'forbidden' });
    expect(gateway.checkIn).not.toHaveBeenCalled();
  });
});

describe('CheckinWorkspace', () => {
  it('searches without rendering score, ranking, rubric, or note fields', async () => {
    const user = userEvent.setup();
    const search = vi.fn(async () => [
      {
        registrationId: 'REG-1042',
        athleteName: 'Ava Smith',
        guardianName: 'Taylor Smith',
        divisionName: 'U13',
        tryoutNumber: 42,
        status: 'ready' as const,
      },
    ]);
    render(<CheckinWorkspace search={search} onCheckIn={vi.fn()} />);
    await user.type(screen.getByLabelText(/search registrations/i), 'Ava');
    await user.click(screen.getByRole('button', { name: /search/i }));
    expect(await screen.findByText('Ava Smith')).toBeInTheDocument();
    expect(screen.getByText(/Taylor Smith/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/score|ranking|rubric|notes/i);
    expect(screen.getByRole('button', { name: /check in Ava Smith/i })).toHaveClass('min-h-[44px]');
  });

  it('shows empty and repeat receipt states accessibly', async () => {
    const user = userEvent.setup();
    render(<CheckinWorkspace search={vi.fn(async () => [])} onCheckIn={vi.fn()} />);
    await user.type(screen.getByLabelText(/search registrations/i), 'Nobody');
    await user.click(screen.getByRole('button', { name: /search/i }));
    expect(await screen.findByText(/no matching registrations/i)).toBeInTheDocument();
  });
});
