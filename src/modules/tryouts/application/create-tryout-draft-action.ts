'use server';

import { requireCurrentOrganization } from '@/modules/organizations/application/current-organization';
import { trackSupabaseWorkflowSafely } from '@/infrastructure/analytics/supabase-analytics-provider';
import { createCorrelationId } from '@/modules/observability/domain/correlation-id';
import { createTryout } from './create-tryout';
import { saveTryoutSetupStep } from './save-tryout-setup-step';
import type { NewTryoutState } from '../ui/new-tryout-form';

export async function createTryoutDraftAction(
  organizationSlug: string,
  _previous: NewTryoutState,
  formData: FormData,
): Promise<NewTryoutState> {
  const route = await requireCurrentOrganization(organizationSlug);
  const result = await createTryout(
    {
      organizationId: route.organization.id,
      seasonId: formData.get('seasonId') || undefined,
      newSeasonName: formData.get('newSeasonName') || undefined,
      name: formData.get('name'),
      sport: formData.get('sport'),
      timezone: formData.get('timezone'),
      registrationStartsAt: formData.get('registrationStartsAt') || undefined,
      registrationEndsAt: formData.get('registrationEndsAt') || undefined,
    },
    { authorization: route.authorization },
  );
  if (!result.ok) {
    if (result.error.code === 'slug_conflict')
      return {
        status: 'error',
        message: 'That tryout name is already in use. Your other entries are still here.',
        fieldErrors: { name: 'Choose a different tryout name.' },
      };
    if (result.error.code === 'invalid_time_range')
      return {
        status: 'error',
        message: 'Registration must close after it opens. Your entries are still here.',
        fieldErrors: { registrationEndsAt: 'Choose a close time after the opening time.' },
      };
    return {
      status: 'error',
      message:
        result.error.code === 'invalid_input'
          ? 'Check the name, sport, timezone and cycle. Your entries are still here.'
          : 'We could not create the draft. Your entries are still here; please try again.',
    };
  }
  await trackSupabaseWorkflowSafely(route.client, {
    name: 'workflow.started',
    workflow: 'tryout_setup',
    organizationId: route.organization.id,
    correlationId: createCorrelationId(),
  });
  const progress = await saveTryoutSetupStep(
    { organizationId: route.organization.id, tryoutId: result.value.id, step: 'basics' },
    { authorization: route.authorization },
  );
  const base = `/app/${organizationSlug}/tryouts/${result.value.id}/setup`;
  return {
    status: 'created',
    href: progress.ok ? `${base}/divisions` : `${base}/basics?created=1&progress=retry`,
  };
}
