import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { FIELD_EXAMPLES } from '@/components/forms/field-examples';
import { can } from '@/modules/organizations/application/capabilities';
import { requireCurrentOrganization } from '@/modules/organizations/application/current-organization';
import { updateOrganizationLogo } from '@/modules/organizations/application/update-organization-logo';
import { updateOrganizationSettings } from '@/modules/organizations/application/update-organization-settings';
import {
  OrganizationLogoSettings,
  type OrganizationLogoSettingsStatus,
} from '@/modules/organizations/components/organization-logo-settings';

function logoStatusFromSearchParams(
  logo: string | string[] | undefined,
  logoError: string | string[] | undefined,
): OrganizationLogoSettingsStatus | undefined {
  if (logo === 'updated' || logo === 'removed') return logo;
  if (
    logoError === 'invalid_file' ||
    logoError === 'too_large' ||
    logoError === 'forbidden' ||
    logoError === 'unavailable'
  ) {
    return logoError;
  }
  return undefined;
}

export default async function SettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ organizationSlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { organizationSlug } = await params;
  const search = await searchParams;
  const current = await requireCurrentOrganization(organizationSlug);
  const logoMetadata = await current.client.rpc('get_organization_logo_metadata', {
    p_organization_id: current.organization.id,
  });
  const hasLogo =
    !logoMetadata.error &&
    logoMetadata.data?.length === 1 &&
    logoMetadata.data[0]?.logo_exists === true;
  const canManageLogo = can(current.authorization, 'organization:update', {
    organizationId: current.organization.id,
  });
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
  async function uploadLogo(formData: FormData) {
    'use server';
    const route = await requireCurrentOrganization(organizationSlug);
    const result = await updateOrganizationLogo(
      { organizationId: route.organization.id, file: formData.get('logo') },
      { userId: route.userId, authorization: route.authorization },
    );
    if (result.ok) revalidatePath(`/app/${organizationSlug}`, 'layout');
    redirect(
      `/app/${organizationSlug}/organization/settings?${result.ok ? 'logo=updated' : `logoError=${result.error.code}`}`,
    );
  }
  async function removeLogo() {
    'use server';
    const route = await requireCurrentOrganization(organizationSlug);
    const result = await updateOrganizationLogo(
      { organizationId: route.organization.id, remove: true },
      { userId: route.userId, authorization: route.authorization },
    );
    if (result.ok) revalidatePath(`/app/${organizationSlug}`, 'layout');
    redirect(
      `/app/${organizationSlug}/organization/settings?${result.ok ? 'logo=removed' : `logoError=${result.error.code}`}`,
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
          placeholder={FIELD_EXAMPLES.timezone}
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
          placeholder={FIELD_EXAMPLES.sports}
        />
        <label htmlFor="tagDefaults">Quick-tag defaults</label>
        <input
          defaultValue={current.organization.tagDefaults.join(', ')}
          id="tagDefaults"
          name="tagDefaults"
          placeholder={FIELD_EXAMPLES.quickTags}
        />
        <button type="submit">Save settings</button>
      </form>
      <OrganizationLogoSettings
        canManage={canManageLogo}
        hasLogo={hasLogo}
        organizationName={current.organization.name}
        organizationSlug={organizationSlug}
        removeAction={removeLogo}
        status={logoStatusFromSearchParams(search.logo, search.logoError)}
        uploadAction={uploadLogo}
      />
    </section>
  );
}
