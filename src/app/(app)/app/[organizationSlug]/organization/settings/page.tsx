import Link from 'next/link';
import { loadWorkspaceNavigation } from '@/modules/organizations/application/team-workspaces';
import { billingUpgradePrompt } from '@/modules/subscriptions/ui/server-feature-gate';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { FIELD_EXAMPLES } from '@/components/forms/field-examples';
import { can } from '@/modules/organizations/application/capabilities';
import { requireCurrentOrganization } from '@/modules/organizations/application/current-organization';
import { updateOrganizationLogo } from '@/modules/organizations/application/update-organization-logo';
import { updateOrganizationSettings } from '@/modules/organizations/application/update-organization-settings';
import { PageHeader } from '@/components/layout/page-header';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { SuggestionInput } from '@/modules/organizations/components/suggestion-input';
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
  const workspace = await loadWorkspaceNavigation(current.client, current.organization.id);
  const sharedSettings = workspace.parent;
  const defaultsUpgrade = await billingUpgradePrompt(
    current.organization.id,
    organizationSlug,
    'organization_management',
  );
  const logoUpgrade = await billingUpgradePrompt(
    current.organization.id,
    organizationSlug,
    'custom_branding',
  );
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
          ...route.organization.terminology,
          athlete: String(
            formData.get('athleteTerm') ?? route.organization.terminology.athlete ?? 'Athlete',
          ),
          athletes: String(
            formData.get('athletesTerm') ?? route.organization.terminology.athletes ?? 'Athletes',
          ),
        },
        sportDefaults: String(
          formData.get('sportDefaults') ?? route.organization.sportDefaults.join(','),
        )
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean),
        tagDefaults: String(formData.get('tagDefaults') ?? route.organization.tagDefaults.join(','))
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean),
      },
      { userId: route.userId, authorization: route.authorization },
    );
    if (result.ok) revalidatePath(`/app/${organizationSlug}`, 'layout');
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
    <div className="workspace-stack">
      <PageHeader
        description="Keep your organization identity, language, and defaults ready for every tryout."
        eyebrow="Organization"
        title="Organization settings"
      />
      {search.saved === '1' ? (
        <p className="auth-status" role="status">
          Settings saved.
        </p>
      ) : null}
      {search.error ? (
        <p className="auth-alert" role="alert">
          We couldn’t save those settings. Check the fields and try again.
        </p>
      ) : null}
      {defaultsUpgrade}
      {sharedSettings ? (
        <div className="workspace-card">
          <h2 className="text-xl font-bold">Shared organization settings</h2>
          <p className="mt-2">
            Branding, terminology, sport defaults and tags are managed by {sharedSettings.name}. You
            can set this team's timezone below.
          </p>
          {sharedSettings.canManage ? (
            <Link
              className="mt-3 inline-block font-bold underline"
              href={`/app/${sharedSettings.slug}/organization/settings`}
            >
              Edit organization settings
            </Link>
          ) : null}
        </div>
      ) : null}
      <form action={save} className="grid gap-6">
        <section className="workspace-card" aria-labelledby="language-heading">
          <div>
            <p className="eyebrow">Defaults</p>
            <h2 id="language-heading" className="workspace-card-title">
              Workspace language
            </h2>
            <p>Choose the terms and timezone your team sees across TryoutFlow.</p>
          </div>
          <FormField
            description="Used for schedules, reminders, and session times."
            htmlFor="timezone"
            label="Timezone"
            required
          >
            {({ describedBy }) => (
              <Input
                defaultValue={current.organization.timezone}
                id="timezone"
                name="timezone"
                placeholder={FIELD_EXAMPLES.timezone}
                aria-describedby={describedBy}
                required
              />
            )}
          </FormField>
          <div className="grid gap-5 sm:grid-cols-2">
            <FormField
              description="What should one participant be called?"
              htmlFor="athleteTerm"
              label="Singular athlete terminology"
              required
            >
              {() => (
                <Input
                  defaultValue={current.organization.terminology.athlete ?? 'Athlete'}
                  disabled={Boolean(defaultsUpgrade) || Boolean(sharedSettings)}
                  id="athleteTerm"
                  name="athleteTerm"
                  required
                />
              )}
            </FormField>
            <FormField
              description="What should multiple participants be called?"
              htmlFor="athletesTerm"
              label="Plural athlete terminology"
              required
            >
              {() => (
                <Input
                  defaultValue={current.organization.terminology.athletes ?? 'Athletes'}
                  disabled={Boolean(defaultsUpgrade) || Boolean(sharedSettings)}
                  id="athletesTerm"
                  name="athletesTerm"
                  required
                />
              )}
            </FormField>
          </div>
        </section>
        <section className="workspace-card" aria-labelledby="suggestions-heading">
          <div>
            <p className="eyebrow">Shortcuts</p>
            <h2 id="suggestions-heading" className="workspace-card-title">
              Smart suggestions
            </h2>
            <p>Set reusable sports and evaluation tags for your team.</p>
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            <FormField htmlFor="sportDefaults" label="Sport defaults">
              {() => (
                <SuggestionInput
                  disabled={Boolean(defaultsUpgrade) || Boolean(sharedSettings)}
                  name="sportDefaults"
                  initialValues={current.organization.sportDefaults}
                  options={[
                    'Hockey',
                    'Ringette',
                    'Soccer',
                    'Basketball',
                    'Volleyball',
                    'Baseball',
                    'Softball',
                    'Football',
                    'Lacrosse',
                  ]}
                />
              )}
            </FormField>
            <FormField htmlFor="tagDefaults" label="Quick-tag defaults">
              {() => (
                <SuggestionInput
                  disabled={Boolean(defaultsUpgrade) || Boolean(sharedSettings)}
                  name="tagDefaults"
                  initialValues={current.organization.tagDefaults}
                  options={[
                    'High effort',
                    'Teamwork',
                    'Communication',
                    'Strong skating',
                    'Decision making',
                    'Needs development',
                  ]}
                />
              )}
            </FormField>
          </div>
          <Button type="submit">Save settings</Button>
        </section>
      </form>
      {sharedSettings
        ? null
        : (logoUpgrade ?? (
            <OrganizationLogoSettings
              canManage={canManageLogo}
              logoUrl={current.organization.logoUrl}
              organizationName={current.organization.name}
              removeAction={removeLogo}
              status={logoStatusFromSearchParams(search.logo, search.logoError)}
              uploadAction={uploadLogo}
            />
          ))}
    </div>
  );
}
