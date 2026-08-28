import { redirect } from 'next/navigation';

import { requireCurrentOrganization } from '@/modules/organizations/application/current-organization';
import { updateOrganizationSettings } from '@/modules/organizations/application/update-organization-settings';

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ organizationSlug: string }>;
}) {
  const { organizationSlug } = await params;
  const current = await requireCurrentOrganization(organizationSlug);
  async function save(formData: FormData) {
    'use server';
    const route = await requireCurrentOrganization(organizationSlug);
    const result = await updateOrganizationSettings(
      {
        organizationId: route.organization.id,
        timezone: formData.get('timezone'),
        terminology: { athlete: String(formData.get('athleteTerm') ?? '') },
      },
      { userId: route.userId, authorization: route.authorization },
    );
    redirect(
      `/app/${organizationSlug}/organization/settings?${result.ok ? 'saved=1' : `error=${result.error.code}`}`,
    );
  }
  return (
    <section aria-labelledby="settings-heading">
      <h2 id="settings-heading">Organization settings</h2>
      <form action={save}>
        <label htmlFor="timezone">Timezone</label>
        <input
          defaultValue={current.organization.timezone}
          id="timezone"
          name="timezone"
          required
        />
        <label htmlFor="athleteTerm">Athlete terminology</label>
        <input defaultValue="Athlete" id="athleteTerm" name="athleteTerm" required />
        <button type="submit">Save settings</button>
      </form>
    </section>
  );
}
