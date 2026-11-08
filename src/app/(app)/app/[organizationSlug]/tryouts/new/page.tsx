import { NewTryoutForm } from '@/modules/tryouts/ui/new-tryout-form';
import { createTryoutDraftAction } from '@/modules/tryouts/application/create-tryout-draft-action';
import Link from 'next/link';
import { billingUpgradePrompt } from '@/modules/subscriptions/ui/server-feature-gate';

import { ErrorState } from '@/components/feedback/error-state';
import { captureOperationalError } from '@/infrastructure/observability/server-observability';

import { requireCurrentOrganization } from '@/modules/organizations/application/current-organization';
import { requireCapability } from '@/modules/organizations/application/require-capability';
import { PageHeader } from '@/components/layout/page-header';

export default async function NewTryoutPage({
  params,
  searchParams,
}: {
  params: Promise<{ organizationSlug: string }>;
  searchParams?: Promise<{ error?: string }>;
}) {
  const { organizationSlug } = await params;
  const query = (await searchParams) ?? {};
  const current = await requireCurrentOrganization(organizationSlug);
  if (
    !requireCapability(current.authorization, 'tryout:write', {
      organizationId: current.organization.id,
    }).ok
  ) {
    return (
      <section className="workspace-stack">
        <PageHeader
          title="Tryout creation restricted"
          description="An owner or administrator can create a tryout. You can continue working on your assigned tasks."
          eyebrow="Tryout setup"
        />
        <Link
          className="button-secondary inline-flex min-h-11 items-center"
          href={`/app/${organizationSlug}/home`}
        >
          Back to your work
        </Link>
      </section>
    );
  }
  const seasonsResult = await current.client
    .from('seasons')
    .select('id,name')
    .eq('organization_id', current.organization.id)
    .order('name');
  if (seasonsResult.error) {
    captureOperationalError(seasonsResult.error, {
      actorId: current.userId,
      organizationId: current.organization.id,
      operation: 'tryouts.load',
    });
    return (
      <ErrorState
        action={
          <Link
            className="button-secondary inline-flex min-h-11 items-center"
            href={`/app/${organizationSlug}/tryouts/new`}
            prefetch={false}
          >
            Retry cycles
          </Link>
        }
        description="Available cycles could not be loaded. No draft was created."
        title="Tryout setup temporarily unavailable"
      />
    );
  }
  const seasons = seasonsResult.data ?? [];
  const defaultsUpgrade = await billingUpgradePrompt(
    current.organization.id,
    organizationSlug,
    'organization_management',
  );
  const defaultSport = defaultsUpgrade ? '' : (current.organization.sportDefaults[0] ?? '');
  const errorMessage =
    query.error === 'slug_conflict'
      ? 'A tryout with that name already exists. Choose a different name.'
      : query.error === 'invalid_time_range'
        ? 'Registration close time must be after the open time.'
        : query.error === 'invalid_input'
          ? 'Enter a tryout name, sport, and exactly one cycle before creating the draft.'
          : query.error
            ? 'We could not create the tryout. Please try again.'
            : undefined;
  return (
    <section aria-labelledby="new-tryout-heading" className="workspace-stack">
      <PageHeader
        description="Create a draft, then configure registration, evaluations, staff, and publishing from the tryout workspace."
        eyebrow="Tryout setup"
        title="Create a tryout"
      />
      {errorMessage ? (
        <p className="auth-alert" role="alert">
          {errorMessage}
        </p>
      ) : null}
      <NewTryoutForm
        recovery={{
          userId: current.userId,
          organizationId: current.organization.id,
          form: 'new',
          baseline: 'new',
        }}
        action={createTryoutDraftAction.bind(null, organizationSlug)}
        seasons={seasons}
        defaultSport={defaultSport}
        timezone={current.organization.timezone}
        defaultCycleName={`${new Date().getFullYear()} season`}
      />
    </section>
  );
}

export const metadata = { title: 'Create a tryout | TryoutFlow' };
