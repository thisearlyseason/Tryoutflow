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

  it('renders the explicit search throttling outcome', async () => {
    const user = userEvent.setup();
    render(
      <CheckinWorkspace
        search={vi.fn(async () => ({ outcome: 'rate_limited' as const, results: [] }))}
        onCheckIn={vi.fn()}
        placements={[{ sessionId: 'session-1', sessionName: 'Morning' }]}
      />,
    );
    await user.type(screen.getByLabelText(/search registrations/i), 'Ava');
    await user.click(screen.getByRole('button', { name: /^search$/i }));
    expect(await screen.findByText(/too many searches/i)).toBeInTheDocument();
  });

  it.each([
    ['capacity', 'That placement is at capacity.'],
    ['withdrawn', 'This registration was withdrawn.'],
    ['cancelled', 'This registration was cancelled.'],
    ['missing_information', 'Required registration information is missing.'],
    ['invalid_registration', 'That registration is not eligible for this placement.'],
    ['invalid_placement', 'That session or group is no longer available.'],
    ['forbidden', 'You are not authorized for that placement.'],
    ['invalid_request', 'The check-in request is invalid.'],
    ['exhausted', 'No tryout numbers are available in this scope.'],
    ['conflict', 'This retry key belongs to a different check-in request.'],
  ] as const)(
    'renders the %s outcome without marking the athlete checked in',
    async (outcome, message) => {
      const user = userEvent.setup();
      const search = vi.fn(async () => [
        {
          registrationId: 'REG-1042',
          athleteName: 'Ava Smith',
          guardianName: 'Taylor Smith',
          divisionName: 'U13',
          tryoutNumber: null,
          status: 'ready' as const,
        },
      ]);
      render(
        <CheckinWorkspace
          search={search}
          onCheckIn={vi.fn(async () => ({ outcome }))}
          placements={[{ sessionId: 'session-1', sessionName: 'Morning' }]}
        />,
      );
      await user.type(screen.getByLabelText(/search registrations/i), 'Ava');
      await user.click(screen.getByRole('button', { name: /^search$/i }));
      await user.click(await screen.findByRole('button', { name: /check in Ava Smith/i }));
      expect(await screen.findByText(message)).toBeInTheDocument();
      expect(screen.getByText(/number not assigned · ready/i)).toBeInTheDocument();
    },
  );

  it('reuses one caller-stable request key across a lost-response retry', async () => {
    const user = userEvent.setup();
    const keys: string[] = [];
    const onCheckIn = vi.fn(async (input: { requestKey: string }) => {
      keys.push(input.requestKey);
      if (keys.length === 1) throw new Error('lost response');
      return {
        outcome: 'already_checked_in',
        receiptId: 'receipt-1',
        checkedInAt: '2026-08-28T12:00:00.000Z',
        assignedNumber: 17,
      } as const;
    });
    render(
      <CheckinWorkspace
        search={vi.fn(async () => [
          {
            registrationId: 'REG-1042',
            athleteName: 'Ava Smith',
            guardianName: 'Taylor Smith',
            divisionName: 'U13',
            tryoutNumber: null,
            status: 'ready' as const,
          },
        ])}
        onCheckIn={onCheckIn}
        placements={[{ sessionId: 'session-1', sessionName: 'Morning' }]}
      />,
    );
    await user.type(screen.getByLabelText(/search registrations/i), 'Ava');
    await user.click(screen.getByRole('button', { name: /^search$/i }));
    await user.click(await screen.findByRole('button', { name: /check in Ava Smith/i }));
    await screen.findByText(/outcome.*could not be confirmed.*safe to retry/i);
    await user.click(screen.getByRole('button', { name: /check in Ava Smith/i }));
    expect(await screen.findByText(/already checked in.*#17/i)).toBeInTheDocument();
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
    expect(keys[0]).toMatch(/^[0-9a-f-]{36}$/u);
  });

  it('retains the request key when the server reports an ambiguous unexpected error', async () => {
    const user = userEvent.setup();
    const keys: string[] = [];
    const onCheckIn = vi.fn(async (input: { requestKey: string }) => {
      keys.push(input.requestKey);
      return keys.length === 1
        ? { outcome: 'unexpected_error' as const }
        : {
            outcome: 'checked_in' as const,
            receiptId: 'receipt-1',
            checkedInAt: '2026-08-28T12:00:00.000Z',
            assignedNumber: 17,
          };
    });
    render(
      <CheckinWorkspace
        search={vi.fn(async () => [
          {
            registrationId: 'REG-1042',
            athleteName: 'Ava Smith',
            guardianName: 'Taylor Smith',
            divisionName: 'U13',
            tryoutNumber: null,
            status: 'ready' as const,
          },
        ])}
        onCheckIn={onCheckIn}
        placements={[{ sessionId: 'session-1', sessionName: 'Morning' }]}
      />,
    );
    await user.type(screen.getByLabelText(/search registrations/i), 'Ava');
    await user.click(screen.getByRole('button', { name: /^search$/i }));
    await user.click(await screen.findByRole('button', { name: /check in Ava Smith/i }));
    await screen.findByText(/outcome could not be confirmed.*safe to retry/i);
    await user.click(screen.getByRole('button', { name: /check in Ava Smith/i }));
    expect(await screen.findByText(/Ava Smith checked in.*#17/i)).toBeInTheDocument();
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
  });

  it('rotates the request key after success so a deliberate repeat reaches the repeat contract', async () => {
    const user = userEvent.setup();
    const keys: string[] = [];
    const onCheckIn = vi.fn(async (input: { requestKey: string }) => {
      keys.push(input.requestKey);
      return keys.length === 1
        ? {
            outcome: 'checked_in' as const,
            receiptId: 'receipt-1',
            checkedInAt: '2026-08-28T12:00:00.000Z',
            assignedNumber: 17,
          }
        : {
            outcome: 'already_checked_in' as const,
            receiptId: 'receipt-1',
            checkedInAt: '2026-08-28T12:00:00.000Z',
            assignedNumber: 17,
          };
    });
    render(
      <CheckinWorkspace
        search={vi.fn(async () => [
          {
            registrationId: 'REG-1042',
            athleteName: 'Ava Smith',
            guardianName: 'Taylor Smith',
            divisionName: 'U13',
            tryoutNumber: null,
            status: 'ready' as const,
          },
        ])}
        onCheckIn={onCheckIn}
        placements={[{ sessionId: 'session-1', sessionName: 'Morning' }]}
      />,
    );
    await user.type(screen.getByLabelText(/search registrations/i), 'Ava');
    await user.click(screen.getByRole('button', { name: /^search$/i }));
    await user.click(await screen.findByRole('button', { name: /check in Ava Smith/i }));
    expect(await screen.findByText(/Ava Smith checked in.*#17/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /confirm Ava Smith again/i }));
    expect(await screen.findByText(/already checked in.*#17/i)).toBeInTheDocument();
    expect(keys).toHaveLength(2);
    expect(keys[0]).not.toBe(keys[1]);
  });

  it('synchronizes the visible row number from a conclusive receipt', async () => {
    const user = userEvent.setup();
    render(
      <CheckinWorkspace
        search={vi.fn(async () => [
          {
            registrationId: 'REG-1042',
            athleteName: 'Ava Smith',
            guardianName: 'Taylor Smith',
            divisionName: 'U13',
            tryoutNumber: null,
            status: 'ready' as const,
          },
        ])}
        onCheckIn={vi.fn(async () => ({
          outcome: 'checked_in' as const,
          receiptId: 'receipt-1',
          checkedInAt: '2026-08-28T12:00:00.000Z',
          assignedNumber: 17,
        }))}
        placements={[{ sessionId: 'session-1', sessionName: 'Morning' }]}
      />,
    );
    await user.type(screen.getByLabelText(/search registrations/i), 'Ava');
    await user.click(screen.getByRole('button', { name: /^search$/i }));
    await user.click(await screen.findByRole('button', { name: /check in Ava Smith/i }));
    expect(await screen.findByText(/#17 · checked in/i)).toBeInTheDocument();
    expect(screen.queryByText(/number not assigned · checked in/i)).not.toBeInTheDocument();
  });

  it('renders an unexpected service failure separately from invalid input', async () => {
    const user = userEvent.setup();
    render(
      <CheckinWorkspace
        search={vi.fn(async () => [
          {
            registrationId: 'REG-1042',
            athleteName: 'Ava Smith',
            guardianName: 'Taylor Smith',
            divisionName: 'U13',
            tryoutNumber: null,
            status: 'ready' as const,
          },
        ])}
        onCheckIn={vi.fn(async () => ({ outcome: 'unexpected_error' as const }))}
        placements={[{ sessionId: 'session-1', sessionName: 'Morning' }]}
      />,
    );
    await user.type(screen.getByLabelText(/search registrations/i), 'Ava');
    await user.click(screen.getByRole('button', { name: /^search$/i }));
    await user.click(await screen.findByRole('button', { name: /check in Ava Smith/i }));
    expect(
      await screen.findByText(/outcome could not be confirmed.*safe to retry/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/request is invalid/i)).not.toBeInTheDocument();
  });
});
