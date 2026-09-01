import { ErrorState } from '@/components/feedback/error-state';
import { captureOperationalError } from '@/infrastructure/observability/server-observability';
import { requireOrganizationRouteContext } from '@/modules/organizations/application/organization-route-context';
import { OrganizationCommandCenter } from '@/modules/organizations/components/organization-command-center';
import { SupabaseOnboardingProgressGateway } from '@/modules/organizations/infrastructure/supabase-onboarding-progress-gateway';

export default async function OrganizationHomePage({
  params,
}: {
  params: Promise<{ organizationSlug: string }>;
}) {
  const { organizationSlug } = await params;
  const current = await requireOrganizationRouteContext(organizationSlug);
  try {
    const projection = await new SupabaseOnboardingProgressGateway(current.client).load(
      current.organization.id,
    );
    return projection ? (
      <OrganizationCommandCenter
        organizationSlug={current.organization.slug}
        projection={projection}
      />
    ) : (
      <ErrorState
        title="Onboarding unavailable"
        description="Your current role cannot view this setup progress."
      />
    );
  } catch (error) {
    captureOperationalError(error, {
      actorId: current.userId,
      organizationId: current.organization.id,
      operation: 'onboarding.load',
    });
    return (
      <ErrorState
        title="Onboarding unavailable"
        description="Refresh to load the latest durable setup progress."
      />
    );
  }
}
