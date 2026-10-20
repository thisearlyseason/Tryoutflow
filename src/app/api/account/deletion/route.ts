import { accountRequestContext } from '@/modules/identity/application/account-request';
import { readBoundedStripeBody } from '@/app/api/webhooks/stripe/stripe-webhook';

function failure(error: unknown) {
  const kind = error instanceof Error ? error.message : '';
  const status = kind === 'unauthorized' ? 401 : kind === 'forbidden' ? 403 : 503;
  return Response.json(
    {
      error:
        status === 401
          ? 'Please sign in to request deletion.'
          : 'Your request could not be saved. Please try again or contact gamedaysportstech@gmail.com.',
    },
    { status, headers: { 'Cache-Control': 'no-store' } },
  );
}
export async function GET(request: Request) {
  try {
    const { client } = await accountRequestContext(request);
    const { data, error } = await client.rpc('get_account_deletion_request');
    if (error) throw error;
    return Response.json({ request: data }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return failure(error);
  }
}
export async function POST(request: Request) {
  try {
    const { client } = await accountRequestContext(request);
    let body;
    try {
      body = JSON.parse(Buffer.from(await readBoundedStripeBody(request, 1024)).toString('utf8'));
    } catch {
      return Response.json({ error: 'Invalid confirmation.' }, { status: 400 });
    }
    if (!body || body.confirm !== true || Object.keys(body).some((key) => key !== 'confirm'))
      return Response.json(
        { error: 'Confirm that you want to request account deletion.' },
        { status: 400 },
      );
    const { data, error } = await client.rpc('request_account_deletion', { p_confirm: true });
    if (error) throw error;
    return Response.json({ request: data }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return failure(error);
  }
}
