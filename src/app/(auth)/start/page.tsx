import { redirect } from 'next/navigation';

import { AuthShell } from '../../../components/layout/auth-shell';
import { FIELD_EXAMPLES } from '../../../components/forms/field-examples';
import { Button } from '../../../components/ui/button';
import { FormField } from '../../../components/ui/form-field';
import { Input } from '../../../components/ui/input';
import { createOrganization } from '../../../modules/organizations/application/create-organization';
import { createServerSupabaseClient } from '../../../infrastructure/supabase/server';
import { parseUserId } from '../../../lib/ids';
import { trackSupabaseWorkflowSafely } from '../../../infrastructure/analytics/supabase-analytics-provider';
import { createCorrelationId } from '../../../modules/observability/domain/correlation-id';

export default function StartPage() {
  async function submit(formData: FormData) {
    'use server';
    const client = await createServerSupabaseClient();
    const {
      data: { user },
    } = await client.auth.getUser();
    if (!user) redirect('/sign-in?next=%2Fstart');
    const result = await createOrganization(
      {
        name: formData.get('name'),
        slug: formData.get('slug'),
        timezone: formData.get('timezone'),
      },
      { userId: parseUserId(user.id) },
    );
    if (!result.ok) redirect(`/start?error=${result.error.code}`);
    await trackSupabaseWorkflowSafely(client, {
      name: 'workflow.completed',
      workflow: 'onboarding',
      organizationId: result.value.organization.id,
      correlationId: createCorrelationId(),
    });
    redirect(`/app/${result.value.organization.slug}/home`);
  }

  return (
    <AuthShell
      description="Start with the team, club, or academy that runs your tryouts. You will be its first owner."
      eyebrow="Organization setup"
      title="Set up your organization"
    >
      <form action={submit}>
        <FormField htmlFor="name" label="Organization name" required>
          {({ describedBy }) => (
            <Input
              aria-describedby={describedBy}
              id="name"
              name="name"
              placeholder={FIELD_EXAMPLES.organizationName}
              required
            />
          )}
        </FormField>
        <FormField
          description="Use a recognizable name; TryoutFlow creates a clean URL for you."
          htmlFor="slug"
          label="Organization URL"
          required
        >
          {({ describedBy }) => (
            <Input
              aria-describedby={describedBy}
              id="slug"
              name="slug"
              placeholder={FIELD_EXAMPLES.organizationName.toLowerCase().replaceAll(' ', '-')}
              required
            />
          )}
        </FormField>
        <FormField
          description={`Example: ${FIELD_EXAMPLES.timezone}.`}
          htmlFor="timezone"
          label="Timezone"
          required
        >
          {({ describedBy }) => (
            <Input
              aria-describedby={describedBy}
              id="timezone"
              name="timezone"
              placeholder={FIELD_EXAMPLES.timezone}
              required
            />
          )}
        </FormField>
        <Button className="mt-2 w-full" type="submit">
          Create organization
        </Button>
      </form>
    </AuthShell>
  );
}
