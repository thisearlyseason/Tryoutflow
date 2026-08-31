import { requirePlatformRouteContext } from '@/modules/observability/application/platform-route-context';
import { OrganizationDirectory } from '@/modules/observability/ui/platform-administration';

export default async function PlatformOrganizationsPage() {
  const { gateway } = await requirePlatformRouteContext();
  const organizations = await gateway.listOrganizations();
  return (
    <section aria-labelledby="platform-organizations-heading">
      <h2 className="text-3xl font-black" id="platform-organizations-heading">
        Organizations
      </h2>
      <p className="mb-6 mt-2 max-w-3xl text-[var(--color-text-muted)]">
        Platform metadata only. Athlete, guardian, evaluation, and roster content is not loaded
        here.
      </p>
      <OrganizationDirectory organizations={organizations} />
    </section>
  );
}
