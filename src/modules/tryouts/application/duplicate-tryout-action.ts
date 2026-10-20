'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { captureOperationalError } from '@/infrastructure/observability/server-observability';
import { requireOrganizationRouteContext } from '@/modules/organizations/application/organization-route-context';
import { requireCapability } from '@/modules/organizations/application/require-capability';

export async function duplicateTryoutAction(
  organizationSlug: string,
  sourceTryoutId: string,
  _previous: { error: string } | null,
): Promise<{ error: string } | null> {
  const current = await requireOrganizationRouteContext(organizationSlug);
  if (
    !requireCapability(current.authorization, 'tryout:write', {
      organizationId: current.organization.id,
      tryoutId: sourceTryoutId,
    }).ok
  )
    return { error: 'You no longer have permission to duplicate this tryout.' };

  let copiedId: string | undefined;
  try {
    const result = await current.client.rpc('duplicate_tryout', {
      p_organization_id: current.organization.id,
      p_source_tryout_id: sourceTryoutId,
    });
    if (result.error) throw result.error;
    copiedId = result.data?.[0]?.tryout_id;
    if (!copiedId) throw new Error('Duplicate tryout returned no draft');
  } catch (error) {
    captureOperationalError(error, {
      actorId: current.userId,
      organizationId: current.organization.id,
      tryoutId: sourceTryoutId,
      operation: 'tryouts.duplicate',
    });
    return {
      error:
        'The tryout could not be duplicated. Please try again. Your original tryout is unchanged.',
    };
  }
  revalidatePath(`/app/${organizationSlug}/tryouts`);
  redirect(`/app/${organizationSlug}/tryouts/${copiedId}/setup/basics`);
}
