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
      'queue_registration_confirmation_communication_v2',
      expect.objectContaining({
        p_confirmation_token_digest: createHash('sha256').update('a'.repeat(64)).digest('hex'),
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
      'queue_invitation_communication_v2',
      expect.objectContaining({
        p_invitation_token_digest: createHash('sha256').update('secret-token').digest('hex'),
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
          commandKind: 'registration_reminder',
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

  it('accepts only server-owned registration command kinds and never accepts a notice class', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{ outcome: 'queued', message_id: 'm', job_id: 'j' }],
      error: null,
    });
    const base = {
      organizationId: '33333333-3333-4333-8333-333333333333',
      registrationId: '11111111-1111-4111-8111-111111111111',
      guardianId: '44444444-4444-4444-8444-444444444444',
      subject: 'Reminder',
      text: 'Body',
      businessIdempotencyKey: 'registration:test:1234567890',
    };
    await expect(
      queueCommunication(
        { ...base, commandKind: 'registration_confirmation' },
        { client: { rpc } },
      ),
    ).resolves.toEqual({ outcome: 'invalid_input' });
    await expect(
      queueCommunication(
        { ...base, commandKind: 'registration_reminder', noticeClass: 'operational' },
        { client: { rpc } },
      ),
    ).resolves.toEqual({ outcome: 'invalid_input' });
    await expect(
      queueCommunication({ ...base, commandKind: 'registration_reminder' }, { client: { rpc } }),
    ).resolves.toEqual({ outcome: 'queued', messageId: 'm', jobId: 'j' });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith(
      'queue_registration_communication_v2',
      expect.not.objectContaining({ p_notice_class: expect.anything() }),
    );
  });
});
