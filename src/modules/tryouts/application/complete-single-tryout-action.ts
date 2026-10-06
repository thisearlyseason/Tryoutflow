'use server';

import { revalidatePath } from 'next/cache';
import { requireOrganizationRouteContext } from '@/modules/organizations/application/organization-route-context';
import { requireCapability } from '@/modules/organizations/application/require-capability';

export async function completeSingleTryoutAction(
  organizationSlug: string,
  tryoutId: string,
  expectedVersion: number,
  _previous: { error?: string; completed?: boolean } | null,
  formData: FormData,
): Promise<{ error?: string; completed?: boolean }> {
  if (formData.get('confirm') !== 'yes') {
    return { error: 'Confirm that scores, selections and messages are finished before locking.' };
  }
  const current = await requireOrganizationRouteContext(organizationSlug);
  if (
    !requireCapability(current.authorization, 'tryout:write', {
      organizationId: current.organization.id,
      tryoutId,
    }).ok
  )
    return { error: 'You do not have permission to complete this tryout.' };
  const { data, error } = await current.client.rpc('complete_single_tryout', {
    p_organization_id: current.organization.id,
    p_tryout_id: tryoutId,
    p_expected_version: expectedVersion,
  });
  if (error || data !== 'completed') {
    return {
      error:
        'This tryout could not be completed. Refresh to load the latest saved changes and try again.',
    };
  }
  revalidatePath(`/app/${organizationSlug}/tryouts`, 'layout');
  return { completed: true };
}
