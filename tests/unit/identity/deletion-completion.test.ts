import { expect, it, vi } from 'vitest';
import { sendDeletionCompletionNotice } from '@/modules/identity/application/deletion-completion';

it('sends the completion notice to the saved requester with a stable idempotency key', async () => {
  const send = vi.fn().mockResolvedValue({ providerMessageId: 'provider-id' });
  const id = '11111111-1111-4111-8111-111111111111';
  await sendDeletionCompletionNotice({ send }, { id, contactEmail: 'requester@example.test' });
  expect(send).toHaveBeenCalledWith(
    expect.objectContaining({
      to: 'requester@example.test',
      subject: 'Your TryoutFlow account deletion is complete',
      text: expect.stringContaining(id),
    }),
    `account-deletion-completed-${id}`,
  );
});
