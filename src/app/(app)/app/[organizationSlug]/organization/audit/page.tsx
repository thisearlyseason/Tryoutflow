import { notFound } from 'next/navigation';

import { parseUserId } from '@/lib/ids';
import { listAuditEvents } from '@/modules/audit/application/list-audit-events';
import { SupabaseAuditEventListGateway } from '@/modules/audit/infrastructure/supabase-audit-event-list-gateway';
import { requireOrganizationRouteContext } from '@/modules/organizations/application/organization-route-context';
import { SupabaseMembershipRepository } from '@/modules/organizations/infrastructure/membership-repository';
import { AuditEventList } from '@/modules/observability/ui/platform-administration';

export default async function OrganizationAuditPage({
  params,
}: {
  params: Promise<{ organizationSlug: string }>;
}) {
  const { organizationSlug } = await params;
  const current = await requireOrganizationRouteContext(organizationSlug);
  const gateway = new SupabaseAuditEventListGateway(
    current.client,
    new SupabaseMembershipRepository(current.client),
  );
  const result = await listAuditEvents(
    {
      actorId: parseUserId(current.userId),
      organizationId: current.organization.id,
      limit: 50,
    },
    gateway,
  );
  if (!result.ok) notFound();
  return (
    <section aria-labelledby="organization-audit-heading">
      <h2 className="text-3xl font-black" id="organization-audit-heading">
        Organization audit
      </h2>
      <p className="mb-6 mt-2 max-w-3xl text-[var(--color-text-muted)]">
        Immutable operational actions for this organization. Private evaluation and guardian data
        are not shown.
      </p>
      <AuditEventList events={result.value} />
    </section>
  );
}
