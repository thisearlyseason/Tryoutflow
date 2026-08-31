import { ErrorState } from '@/components/feedback/error-state';
import { requireOrganizationRouteContext } from '@/modules/organizations/application/organization-route-context';
import { OnboardingChecklist } from '@/modules/organizations/components/onboarding-checklist';
import { SupabaseOnboardingProgressGateway } from '@/modules/organizations/infrastructure/supabase-onboarding-progress-gateway';

export default async function OrganizationHomePage({
  params,
}: {
  params: Promise<{ organizationSlug: string }>;
}) {
  const { organizationSlug } = await params;
  const current = await requireOrganizationRouteContext(organizationSlug);
  try {
    const progress = await new SupabaseOnboardingProgressGateway(current.client).load(
      current.organization.id,
    );
    return progress ? (
      <OnboardingChecklist progress={progress} />
    ) : (
      <ErrorState
        title="Onboarding unavailable"
        description="Your current role cannot view this setup progress."
      />
    );
  } catch {
    return (
      <ErrorState
        title="Onboarding unavailable"
        description="Refresh to load the latest durable setup progress."
      />
    );
  }
}
