import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { PageHeader } from '@/components/layout/page-header';
import { requireCurrentOrganization } from '@/modules/organizations/application/current-organization';
import {
  createTeamWorkspaceSchema,
  loadWorkspaceNavigation,
  summarizeTeamWorkspaces,
  teamWorkspacesSchema,
} from '@/modules/organizations/application/team-workspaces';
import {
  CreateTeamWorkspaceForm,
  type CreateTeamState,
} from '@/modules/organizations/components/create-team-workspace-form';
import { getEffectiveEntitlements } from '@/modules/subscriptions/application/billing-service';
import { hasEntitlement } from '@/modules/subscriptions/domain/effective-entitlements';
import { FeatureGate } from '@/modules/subscriptions/ui/feature-gate';

export default async function TeamWorkspacesPage({
  params,
}: {
  params: Promise<{ organizationSlug: string }>;
}) {
  const { organizationSlug } = await params;
  const current = await requireCurrentOrganization(organizationSlug);
  if (!['owner', 'administrator'].includes(current.authorization.organizationRole)) notFound();
  const navigation = await loadWorkspaceNavigation(current.client, current.organization.id);
  if (navigation.parent) {
    if (navigation.parent.canManage) redirect(`/app/${navigation.parent.slug}/organization/teams`);
    notFound();
  }
  const access = await getEffectiveEntitlements(current.organization.id);
  if (!hasEntitlement(access, 'organization_management'))
    return (
      <section className="workspace-stack">
        <PageHeader title="Team workspaces" description="Separate team spaces, one organization." />
        <FeatureGate
          access={access}
          feature="organization_management"
          billingHref={`/app/${organizationSlug}/organization/billing`}
        >
          {null}
        </FeatureGate>
        <p>Your existing team data stays saved when your plan changes.</p>
      </section>
    );
  const { data, error } = await current.client.rpc('list_team_workspaces', {
    p_organization_id: current.organization.id,
  });
  if (error) throw new Error('Team workspaces are temporarily unavailable.');
  const teams = teamWorkspacesSchema.parse(data);
  const totals = summarizeTeamWorkspaces(teams);
  async function create(_state: CreateTeamState, formData: FormData): Promise<CreateTeamState> {
    'use server';
    const route = await requireCurrentOrganization(organizationSlug);
    const parsed = createTeamWorkspaceSchema.safeParse({
      name: formData.get('name'),
      slug: formData.get('slug'),
    });
    if (!parsed.success)
      return {
        error: 'Enter a team name and an address using lowercase letters, numbers and hyphens.',
      };
    const result = await route.client.rpc('create_team_workspace', {
      p_organization_id: route.organization.id,
      p_name: parsed.data.name,
      p_slug: parsed.data.slug,
    });
    if (result.error)
      return {
        error:
          result.error.code === '23505'
            ? 'That workspace address is taken. Choose another address.'
            : result.error.code === '42501'
              ? 'An active Organization plan and organization administrator access are required.'
              : 'We could not create the team workspace. Please try again.',
      };
    revalidatePath(`/app/${organizationSlug}`, 'layout');
    redirect(`/app/${parsed.data.slug}/home`);
  }
  return (
    <section className="workspace-stack">
      <PageHeader
        eyebrow={current.organization.name}
        title="Your teams. One organization."
        description="Give coaches a focused workspace while you keep a clear view of the whole program."
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Object.entries({
          Teams: totals.teams,
          Tryouts: totals.tryouts,
          'Athlete records': totals.athletes,
          'Completed evaluations': totals.completedEvaluations,
        }).map(([label, value]) => (
          <div className="workspace-card" style={{ minHeight: '7rem' }} key={label}>
            <p className="eyebrow">{label}</p>
            <strong className="text-3xl">{value}</strong>
          </div>
        ))}
      </div>
      <p className="text-sm text-[var(--color-text-muted)]">
        Totals cover team workspaces. An athlete registered with two teams counts in each team.
        Records in your organization workspace are separate.
      </p>
      <CreateTeamWorkspaceForm action={create} parentSlug={organizationSlug} />
      <section aria-label="Team workspaces" className="workspace-card-grid">
        {teams.map((team) => (
          <article className="workspace-card" key={team.id}>
            <p className="eyebrow">Team workspace</p>
            <h2 className="text-2xl font-bold">{team.name}</h2>
            <p className="my-3 text-sm text-[var(--color-text-muted)]">
              {team.tryouts} tryouts · {team.athletes} athlete records · {team.coaches}{' '}
              {team.coaches === 1 ? 'team coach' : 'team coaches'}
            </p>
            <p className="text-sm">{team.completedEvaluations} completed evaluations</p>
            <div className="mt-4 flex flex-wrap gap-3">
              <Link className="button button-primary" href={`/app/${team.slug}/home`}>
                Open workspace
              </Link>
              <Link
                className="button button-secondary"
                href={`/app/${team.slug}/organization/members`}
              >
                Manage coaches
              </Link>
              <Link className="button button-secondary" href={`/app/${team.slug}/reports`}>
                View reports
              </Link>
            </div>
          </article>
        ))}
        {!teams.length ? (
          <p className="workspace-card">
            Create your first team above, then invite its coaches from Members & permissions.
          </p>
        ) : null}
      </section>
      <div className="workspace-card">
        <h2 className="text-xl font-bold">Shared foundations. Separate team data.</h2>
        <p className="mt-2">
          Organization owners and administrators can access every team. Team coaches only access
          teams they are invited to. Branding and program defaults are managed in organization
          settings; billing stays with the organization owner.
        </p>
        <Link
          className="mt-3 inline-block font-bold underline"
          href={`/app/${organizationSlug}/organization/settings`}
        >
          Manage shared settings
        </Link>
      </div>
    </section>
  );
}
