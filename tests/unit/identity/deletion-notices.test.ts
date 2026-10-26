import { expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/infrastructure/supabase/database.types';
import { sendDeletionNotices } from '@/modules/identity/application/deletion-notices';
const id = '11111111-1111-4111-8111-111111111111';
it('notifies the monitored inbox with stable idempotency and no customer personal data', async () => {
  const rpc = vi
    .fn()
    .mockResolvedValueOnce({
      data: [{ id, requested_at: '2026-09-29', due_at: '2026-10-06' }],
      error: null,
    })
    .mockResolvedValue({ error: null });
  const send = vi.fn().mockResolvedValue({ providerMessageId: id });
  await sendDeletionNotices({ rpc } as unknown as SupabaseClient<Database>, { send });
  expect(send).toHaveBeenCalledWith(
    expect.objectContaining({
      to: 'gamedaysportstech@gmail.com',
      text: expect.stringContaining('https://www.tryout.agency/platform/deletions'),
    }),
    `account-deletion-${id}`,
  );
  expect(rpc).toHaveBeenLastCalledWith('record_account_deletion_notice', {
    p_id: id,
    p_provider_id: id,
  });
});
it('leaves unsuccessful notification pending for retry', async () => {
  const rpc = vi.fn().mockResolvedValue({
    data: [{ id, requested_at: '2026-09-29', due_at: '2026-10-06' }],
    error: null,
  });
  const send = vi.fn().mockRejectedValue(new Error('provider unavailable'));
  await expect(
    sendDeletionNotices({ rpc } as unknown as SupabaseClient<Database>, { send }),
  ).rejects.toThrow();
  expect(rpc).toHaveBeenCalledTimes(1);
});
