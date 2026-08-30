import { describe, expect, it } from 'vitest';

import {
  bindBatchConfirmation,
  createMessageBatch,
  createRecipientPreview,
} from '../../../src/modules/communications/application/create-message-batch';

const recipients = [
  {
    registrationId: '11111111-1111-4111-8111-111111111111',
    recipientEmail: 'one@example.com',
    athletePreferredName: 'Ava',
  },
  {
    registrationId: '22222222-2222-4222-8222-222222222222',
    recipientEmail: 'two@example.com',
    athletePreferredName: 'Bea',
  },
];

describe('decision message batch confirmation', () => {
  it('binds confirmation to the exact ordered recipient set, roster version, and copy', async () => {
    const preview = createRecipientPreview({
      organizationId: '33333333-3333-4333-8333-333333333333',
      rosterVersionId: '44444444-4444-4444-8444-444444444444',
      rosterVersion: 9,
      kind: 'selected',
      editableText: 'Welcome.',
      recipients,
    });
    const confirmation = bindBatchConfirmation(preview);
    expect(preview.count).toBe(2);
    expect(preview.recipients[0]).toEqual({
      registrationId: recipients[0]!.registrationId,
      recipientEmail: 'one@example.com',
      athletePreferredName: 'Ava',
    });

    const rpc = async (_name: string, args: Record<string, unknown>) => ({
      data: {
        outcome: 'queued',
        batch_id: '55555555-5555-4555-8555-555555555555',
        queued_count: 2,
      },
      error: null,
      args,
    });
    await expect(createMessageBatch(confirmation, { rpc })).resolves.toMatchObject({
      outcome: 'queued',
      queuedCount: 2,
    });
  });

  it('changes the digest when recipient identity, copy, or version changes', () => {
    const base = {
      organizationId: '33333333-3333-4333-8333-333333333333',
      rosterVersionId: '44444444-4444-4444-8444-444444444444',
      rosterVersion: 9,
      kind: 'selected' as const,
      editableText: 'Welcome.',
      recipients,
    };
    const digest = createRecipientPreview(base).digest;
    expect(createRecipientPreview({ ...base, rosterVersion: 10 }).digest).not.toBe(digest);
    expect(createRecipientPreview({ ...base, editableText: 'Changed.' }).digest).not.toBe(digest);
    expect(createRecipientPreview({ ...base, recipients: recipients.slice(0, 1) }).digest).not.toBe(
      digest,
    );
  });
});
