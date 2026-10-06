import { billingRequestContext } from '@/modules/subscriptions/application/billing-request';
export async function GET(request: Request) {
  try {
    const { client, user } = await billingRequestContext(request);
    const { data, error } = await client
      .from('organization_members')
      .select(
        'organization_id,role,organizations!organization_members_organization_id_fkey!inner(id,name,slug)',
      )
      .is('organizations.parent_organization_id', null)
      .eq('user_id', user.id)
      .eq('status', 'active');
    if (error) throw error;
    return Response.json({ organizations: data }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ error: 'Please sign in to view your organizations.' }, { status: 401 });
  }
}
