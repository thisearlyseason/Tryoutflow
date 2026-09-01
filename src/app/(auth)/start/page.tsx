import { redirect } from 'next/navigation';

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
    <main className="auth-page">
      <section aria-labelledby="start-heading" className="auth-card">
        <p className="eyebrow">TryoutFlow setup</p>
        <h1 id="start-heading">Set up your organization</h1>
        <p>Start with the team or academy that runs your tryouts. You will be its first owner.</p>
        <form action={submit}>
          <label htmlFor="name">Organization name</label>
          <input id="name" name="name" required />
          <label htmlFor="slug">Organization URL</label>
          <input aria-describedby="slug-help" id="slug" name="slug" required />
          <p id="slug-help">Use a recognizable name; TryoutFlow creates a clean URL for you.</p>
          <label htmlFor="timezone">Timezone</label>
          <input defaultValue="America/Edmonton" id="timezone" name="timezone" required />
          <button type="submit">Create organization</button>
        </form>
      </section>
    </main>
  );
}
