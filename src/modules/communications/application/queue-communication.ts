import { communicationCommandSchema, type QueueCommunicationResult } from '../domain/message';
import { createHash } from 'node:crypto';

import type { InvitationNotifier } from '../../organizations/application/invitation-notifier';
import type { RegistrationConfirmationNotifier } from '../../registration/application/registration-confirmation-notifier';

type RpcClient = {
  rpc(
    name: 'queue_registration_communication',
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { code?: string } | null }>;
};

export async function queueCommunication(
  input: unknown,
  dependencies: { client: RpcClient },
): Promise<QueueCommunicationResult> {
  const parsed = communicationCommandSchema.safeParse(input);
  if (!parsed.success) return { outcome: 'invalid_input' };
  const command = parsed.data;
  const { data, error } = await dependencies.client.rpc('queue_registration_communication', {
    p_organization_id: command.organizationId,
    p_registration_id: command.registrationId,
    p_guardian_id: command.guardianId,
    p_message_kind: command.messageKind,
    p_notice_class: command.noticeClass,
    p_subject: command.subject,
    p_text: command.text,
    p_business_idempotency_key: command.businessIdempotencyKey,
  });
  if (error) return { outcome: 'invalid_input' };
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== 'object') return { outcome: 'invalid_input' };
  const outcome = String((row as { outcome?: unknown }).outcome);
  if (outcome === 'queued' || outcome === 'replayed') {
    const messageId = String((row as { message_id?: unknown }).message_id);
    const jobId = String((row as { job_id?: unknown }).job_id);
    return { outcome, messageId, jobId };
  }
  return ['suppressed', 'forbidden', 'invalid_input', 'idempotency_conflict'].includes(outcome)
    ? { outcome: outcome as 'suppressed' | 'forbidden' | 'invalid_input' | 'idempotency_conflict' }
    : { outcome: 'invalid_input' };
}

type OperationalRpcClient = {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
};

function rpcOutcome(data: unknown): string {
  const row = Array.isArray(data) ? data[0] : data;
  return row && typeof row === 'object' ? String((row as { outcome?: unknown }).outcome) : '';
}

export class DurableRegistrationConfirmationNotifier implements RegistrationConfirmationNotifier {
  constructor(
    private readonly client: OperationalRpcClient,
    private readonly render: (input: { registrationId: string; confirmationToken: string }) => {
      subject: string;
      text: string;
    },
  ) {}

  async enqueue(input: {
    registrationId: string;
    confirmationToken: string;
    guardianEmail: string;
  }) {
    try {
      const content = this.render(input);
      const tokenDigest = createHash('sha256').update(input.confirmationToken).digest('hex');
      const { data, error } = await this.client.rpc(
        'queue_registration_confirmation_communication',
        {
          p_registration_id: input.registrationId,
          p_guardian_email: input.guardianEmail,
          p_subject: content.subject,
          p_text: content.text,
          p_business_idempotency_key: `registration-confirmation:${input.registrationId}:${tokenDigest}`,
        },
      );
      return !error && ['queued', 'replayed'].includes(rpcOutcome(data))
        ? ({ queued: true } as const)
        : ({ queued: false, reason: 'not_configured' } as const);
    } catch {
      return { queued: false, reason: 'not_configured' } as const;
    }
  }
}

export class DurableInvitationNotifier implements InvitationNotifier {
  constructor(
    private readonly client: OperationalRpcClient,
    private readonly render: (input: { token: string; expiresAt: Date }) => {
      subject: string;
      text: string;
    },
  ) {}

  async enqueue(input: {
    invitationId: string;
    organizationId: string;
    email: string;
    token: string;
    expiresAt: Date;
  }): Promise<void> {
    const content = this.render({ token: input.token, expiresAt: input.expiresAt });
    const { data, error } = await this.client.rpc('queue_invitation_communication', {
      p_organization_id: input.organizationId,
      p_invitation_id: input.invitationId,
      p_subject: content.subject,
      p_text: content.text,
      p_business_idempotency_key: `invitation:${input.invitationId}`,
    });
    if (error || !['queued', 'replayed'].includes(rpcOutcome(data)))
      throw new Error('invitation_not_queued');
  }
}
