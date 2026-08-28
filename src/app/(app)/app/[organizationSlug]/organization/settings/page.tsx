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
        terminology: {
          athlete: String(formData.get('athleteTerm') ?? ''),
          athletes: String(formData.get('athletesTerm') ?? ''),
        },
        sportDefaults: String(formData.get('sportDefaults') ?? '')
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean),
        tagDefaults: String(formData.get('tagDefaults') ?? '')
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean),
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
        <label htmlFor="athleteTerm">Singular athlete terminology</label>
        <input
          defaultValue={current.organization.terminology.athlete ?? 'Athlete'}
          id="athleteTerm"
          name="athleteTerm"
          required
        />
        <label htmlFor="athletesTerm">Plural athlete terminology</label>
        <input
          defaultValue={current.organization.terminology.athletes ?? 'Athletes'}
          id="athletesTerm"
          name="athletesTerm"
          required
        />
        <label htmlFor="sportDefaults">Sport defaults</label>
        <input
          defaultValue={current.organization.sportDefaults.join(', ')}
          id="sportDefaults"
          name="sportDefaults"
        />
        <label htmlFor="tagDefaults">Quick-tag defaults</label>
        <input
          defaultValue={current.organization.tagDefaults.join(', ')}
          id="tagDefaults"
          name="tagDefaults"
        />
        <button type="submit">Save settings</button>
      </form>
    </section>
  );
}
