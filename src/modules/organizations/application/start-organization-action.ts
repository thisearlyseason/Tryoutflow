'use server';

import { redirect } from 'next/navigation';
import { createServerSupabaseClient } from '@/infrastructure/supabase/server';
import { trackSupabaseWorkflowSafely } from '@/infrastructure/analytics/supabase-analytics-provider';
import { createCorrelationId } from '@/modules/observability/domain/correlation-id';
import { parseUserId } from '@/lib/ids';
import { createOrganization } from './create-organization';
import type { StartOrganizationState } from '../ui/start-organization-form';

export async function startOrganizationAction(
  _previous: StartOrganizationState,
  data: FormData,
): Promise<StartOrganizationState> {
  const client = await createServerSupabaseClient();
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) redirect('/sign-in?next=%2Fstart');
  const result = await createOrganization(
    { name: data.get('name'), slug: data.get('slug'), timezone: data.get('timezone') },
    { userId: parseUserId(user.id) },
  );
  if (!result.ok) {
    if (result.error.code === 'slug_conflict')
      return {
        status: 'error',
        message: 'Choose another workspace address. Your other details are still here.',
        fieldErrors: {
          slug: 'That workspace address is already in use. Try adding your team or city.',
        },
      };
    return {
      status: 'error',
      message:
        result.error.code === 'invalid_input'
          ? 'Check the organization name, workspace address and timezone. Your entries are still here.'
          : 'We could not create your organization. Your entries are still here; please try again.',
    };
  }
  await trackSupabaseWorkflowSafely(client, {
    name: 'workflow.completed',
    workflow: 'onboarding',
    organizationId: result.value.organization.id,
    correlationId: createCorrelationId(),
  });
  redirect(`/app/${result.value.organization.slug}/home`);
}
