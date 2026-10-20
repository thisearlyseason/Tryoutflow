import { handleStripeWebhook } from './stripe-webhook';

export async function POST(request: Request) {
  return handleStripeWebhook(request);
}

export async function GET() {
  return new Response(null, { status: 405, headers: { Allow: 'POST' } });
}
