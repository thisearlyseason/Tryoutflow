// @vitest-environment node

import { createHash } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import {
  DurableInvitationNotifier,
  DurableRegistrationConfirmationNotifier,
  queueCommunication,
} from '../../../src/modules/communications/application/queue-communication';

describe('durable communication adapters', () => {
  it('queues registration delivery with a token-bound stable key and falls back truthfully', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [{ outcome: 'queued' }], error: null });
    const notifier = new DurableRegistrationConfirmationNotifier(
      { rpc },
      ({ confirmationToken }) => ({ subject: 'Confirm', text: `Token ${confirmationToken}` }),
    );
    await expect(
      notifier.enqueue({
        registrationId: '11111111-1111-4111-8111-111111111111',
        confirmationToken: 'a'.repeat(64),
        guardianEmail: 'guardian@example.com',
      }),
    ).resolves.toEqual({ queued: true });
    expect(rpc).toHaveBeenCalledWith(
      'queue_registration_confirmation_communication',
      expect.objectContaining({
        p_business_idempotency_key: `registration-confirmation:11111111-1111-4111-8111-111111111111:${createHash('sha256').update('a'.repeat(64)).digest('hex')}`,
      }),
    );

    const unavailable = new DurableRegistrationConfirmationNotifier(
      { rpc: vi.fn().mockRejectedValue(new Error('private provider detail')) },
      () => ({ subject: 'Confirm', text: 'Body' }),
    );
    await expect(
      unavailable.enqueue({
        registrationId: '11111111-1111-4111-8111-111111111111',
        confirmationToken: 'b'.repeat(64),
        guardianEmail: 'guardian@example.com',
      }),
    ).resolves.toEqual({ queued: false, reason: 'not_configured' });
  });

  it('queues the exact invitation snapshot or throws without exposing message content', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [{ outcome: 'replayed' }], error: null });
    const notifier = new DurableInvitationNotifier({ rpc }, ({ token }) => ({
      subject: 'Invitation',
      text: `Use ${token}`,
    }));
    await expect(
      notifier.enqueue({
        invitationId: '22222222-2222-4222-8222-222222222222',
        organizationId: '33333333-3333-4333-8333-333333333333',
        email: 'member@example.com',
        token: 'secret-token',
        expiresAt: new Date('2026-09-01T00:00:00.000Z'),
      }),
    ).resolves.toBeUndefined();
    expect(rpc).toHaveBeenCalledWith(
      'queue_invitation_communication',
      expect.objectContaining({
        p_business_idempotency_key: 'invitation:22222222-2222-4222-8222-222222222222',
      }),
    );
  });

  it('rejects extra private fields before reaching persistence', async () => {
    const rpc = vi.fn();
    await expect(
      queueCommunication(
        {
          organizationId: '33333333-3333-4333-8333-333333333333',
          registrationId: '11111111-1111-4111-8111-111111111111',
          guardianId: '44444444-4444-4444-8444-444444444444',
          messageKind: 'registration_confirmation',
          noticeClass: 'operational',
          subject: 'Confirm',
          text: 'Body',
          businessIdempotencyKey: 'registration:test:1234567890',
          privateNote: 'must not persist',
        },
        { client: { rpc } },
      ),
    ).resolves.toEqual({ outcome: 'invalid_input' });
    expect(rpc).not.toHaveBeenCalled();
  });
});
