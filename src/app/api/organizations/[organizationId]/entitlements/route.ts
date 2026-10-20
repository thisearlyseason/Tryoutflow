import { z } from 'zod';
import { billingRequestContext } from '@/modules/subscriptions/application/billing-request';
export async function GET(
  request: Request,
  { params }: { params: Promise<{ organizationId: string }> },
) {
  try {
    const { organizationId } = await params;
    z.uuid().parse(organizationId);
    const { client } = await billingRequestContext(request);
    const tryoutId = new URL(request.url).searchParams.get('tryoutId');
    if (tryoutId) z.uuid().parse(tryoutId);
    const { data, error } = await client.rpc('get_effective_entitlements', {
      p_organization_id: organizationId,
      p_tryout_id: tryoutId ?? undefined,
    });
    if (error) throw error;
    return Response.json(
      { access: data, subscriptions: [] },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch {
    return Response.json(
      { error: 'This organization is not available to your account.' },
      { status: 403 },
    );
  }
}
