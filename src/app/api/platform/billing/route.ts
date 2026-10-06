import { z } from 'zod';
import { requirePlatformRouteContext } from '@/modules/observability/application/platform-route-context';
import { readBoundedStripeBody } from '@/app/api/webhooks/stripe/stripe-webhook';
const schema = z.object({
  action: z.enum(['inspect', 'grant', 'revoke']),
  organizationId: z.uuid(),
  product: z.enum(['pro_monthly', 'organization_monthly']),
  reason: z.string().max(500),
  expiresAt: z.iso.datetime().nullable(),
  revokeId: z.uuid().optional(),
});
export async function POST(request: Request) {
  try {
    if (request.headers.get('origin') !== new URL(process.env.NEXT_PUBLIC_APP_URL!).origin)
      throw new Error('forbidden');
    const { client } = await requirePlatformRouteContext();
    const input = schema.parse(
      JSON.parse(Buffer.from(await readBoundedStripeBody(request, 4096)).toString('utf8')),
    );
    if (input.action !== 'inspect') {
      if (
        input.action === 'grant' &&
        (!input.expiresAt ||
          Date.parse(input.expiresAt) <= Date.now() ||
          input.reason.trim().length < 3)
      )
        throw new Error('invalid_grant');
      if (input.action === 'revoke' && !input.revokeId) throw new Error('invalid_revoke');
      const { error } = await client.rpc('manage_billing_override', {
        p_organization_id: input.organizationId,
        p_product_key: input.product,
        p_reason: input.reason || 'Administrative revocation',
        p_starts_at: new Date().toISOString(),
        p_expires_at: input.expiresAt ?? new Date().toISOString(),
        p_revoke_id: input.revokeId,
      });
      if (error) throw error;
    }
    const { data, error } = await client.rpc('get_billing_dashboard', {
      p_organization_id: input.organizationId,
    });
    if (error) throw error;
    return Response.json(data);
  } catch {
    return Response.json({ error: 'Unable to access billing administration.' }, { status: 403 });
  }
}
