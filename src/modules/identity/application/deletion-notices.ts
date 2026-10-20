import 'server-only';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/infrastructure/supabase/database.types';
import type { EmailProvider } from '@/infrastructure/email/email-provider';
const schema = z.array(z.object({ id: z.uuid(), requested_at: z.string(), due_at: z.string() }));
export async function sendDeletionNotices(
  client: SupabaseClient<Database>,
  provider: EmailProvider,
) {
  const { data, error } = await client.rpc('pending_account_deletion_notices');
  if (error) throw new Error('deletion_notice_queue_unavailable');
  for (const request of schema.parse(data)) {
    // Only a reference and deadline leave the restricted queue; customer details require platform login.
    const sent = await provider.send(
      {
        to: 'gamedaysportstech@gmail.com',
        subject: 'TryoutFlow account deletion request requires action',
        text: `GameDay Technologies received account-deletion request ${request.id} at ${request.requested_at}. Complete it by ${request.due_at}. Review the restricted queue at:\nhttps://www.tryout.agency/platform/deletions\nVerify shared organization handling, personal-data removal and billing cancellation, then confirm completion with the requester.`,
        messageId: request.id,
      },
      `account-deletion-${request.id}`,
    );
    const recorded = await client.rpc('record_account_deletion_notice', {
      p_id: request.id,
      p_provider_id: sent.providerMessageId,
    });
    if (recorded.error) throw new Error('deletion_notice_status_unavailable');
  }
}
