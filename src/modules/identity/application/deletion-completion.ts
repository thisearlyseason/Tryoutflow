import 'server-only';

import type { EmailProvider } from '@/infrastructure/email/email-provider';

export async function sendDeletionCompletionNotice(
  provider: EmailProvider,
  request: { id: string; contactEmail: string },
) {
  await provider.send(
    {
      to: request.contactEmail,
      subject: 'Your TryoutFlow account deletion is complete',
      text: `GameDay Technologies has completed your TryoutFlow account-deletion request ${request.id}. Your account has been removed. If you have questions about the request, contact gamedaysportstech@gmail.com.\nhttps://www.tryout.agency/support`,
      messageId: request.id,
    },
    `account-deletion-completed-${request.id}`,
  );
}
