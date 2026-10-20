import { requirePlatformRouteContext } from '@/modules/observability/application/platform-route-context';
import { AuditEventList } from '@/modules/observability/ui/platform-administration';

export default async function PlatformAuditPage() {
  const { gateway } = await requirePlatformRouteContext();
  const events = await gateway.listAuditEvents();
  return (
    <section aria-labelledby="platform-audit-heading">
      <h2 className="text-3xl font-black" id="platform-audit-heading">
        Platform audit
      </h2>
      <p className="mb-6 mt-2 max-w-3xl text-[var(--color-text-muted)]">
        Immutable action, actor, target, organization, and timestamp fields. Generic metadata is
        deliberately excluded.
      </p>
      <AuditEventList events={events} />
    </section>
  );
}
