import { FeedbackButton } from '@/components/ui/button';
import { redirect } from 'next/navigation';
import { requirePlatformRouteContext } from '@/modules/observability/application/platform-route-context';
import { z } from 'zod';
import { ResendEmailProvider } from '@/infrastructure/email/resend-provider';
import { sendDeletionCompletionNotice } from '@/modules/identity/application/deletion-completion';
const requestSchema = z.object({
  id: z.string(),
  user_id: z.string().nullable(),
  contact_email: z.string().nullable(),
  requested_at: z.string(),
  due_at: z.string(),
  status: z.string(),
  organization_snapshot: z.array(z.object({ id: z.string(), name: z.string(), role: z.string() })),
});
export default async function DeletionRequestsPage() {
  const { client } = await requirePlatformRouteContext();
  const { data, error } = await client.rpc('platform_account_deletion_requests');
  if (error) throw new Error('Deletion queue is unavailable.');
  const requests = z.array(requestSchema).parse(data);
  async function update(form: FormData) {
    'use server';
    const { client: authorized } = await requirePlatformRouteContext();
    const id = z.uuid().parse(form.get('id'));
    const completing = form.get('complete') === 'yes';
    const confirmed = form.get('confirmed') === 'on';
    if (completing) {
      if (!confirmed) throw new Error('Confirm verified account removal before completion.');
      const { data, error: queueError } = await authorized.rpc(
        'platform_account_deletion_requests',
      );
      if (queueError) throw new Error('Deletion queue is unavailable.');
      const request = z
        .array(requestSchema)
        .parse(data)
        .find((item) => item.id === id);
      if (!request || request.user_id !== null || !request.contact_email) {
        throw new Error('Verify account removal and the contact address before completion.');
      }
      await sendDeletionCompletionNotice(
        new ResendEmailProvider({
          apiKey: process.env.RESEND_API_KEY,
          from: process.env.RESEND_FROM_EMAIL,
          timeoutMs: 2_000,
        }),
        { id, contactEmail: request.contact_email },
      );
    }
    const { error } = await authorized.rpc('platform_update_account_deletion', {
      p_id: id,
      p_complete: completing,
      p_confirmed: confirmed,
    });
    if (error)
      throw new Error(
        'Could not update request. Account removal, data handling and completion notification must be verified first.',
      );
    redirect('/platform/deletions');
  }
  return (
    <section className="grid min-w-0 gap-5">
      <h1 className="text-3xl font-bold">Account deletion requests</h1>
      <p className="max-w-3xl">
        Complete verified requests within seven days. Coordinate an agreed ownership transfer or
        explicit organization closure, cancel applicable web billing, and remove personal data. The
        completion action sends a confirmation email before recording the request as complete.
      </p>
      {requests.length === 0 ? (
        <p>No open requests.</p>
      ) : (
        requests.map((request) => (
          <article className="card min-w-0 p-5" key={request.id}>
            <h2 className="font-bold break-all">{request.contact_email ?? 'Contact removed'}</h2>
            <p>
              Due: {new Date(request.due_at).toISOString()}{' '}
              {Date.parse(request.due_at) < Date.now() ? '— OVERDUE' : ''}
            </p>
            <p>Status: {request.status}</p>
            <p className="break-all">Request: {request.id}</p>
            <p className="break-all">
              Account:{' '}
              {request.user_id ?? 'Auth account removed; verify remaining data and confirmation'}
            </p>
            <ul>
              {request.organization_snapshot.map((org) => (
                <li key={org.id}>
                  {org.name} — {org.role} ({org.id})
                </li>
              ))}
            </ul>
            <form action={update} className="mt-4 grid gap-3">
              <input type="hidden" name="id" value={request.id} />
              {request.user_id ? (
                <FeedbackButton className="button-secondary" type="submit">
                  Mark processing
                </FeedbackButton>
              ) : (
                <>
                  <input type="hidden" name="complete" value="yes" />
                  <label className="flex gap-3">
                    <input type="checkbox" name="confirmed" required />
                    <span>
                      I verified personal-data removal, agreed organization handling and billing
                      cancellation. Send the completion notice and close this request.
                    </span>
                  </label>
                  <FeedbackButton className="button-secondary" type="submit">
                    Record verified completion
                  </FeedbackButton>
                </>
              )}
            </form>
          </article>
        ))
      )}
    </section>
  );
}
