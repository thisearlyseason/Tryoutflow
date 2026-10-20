import { requirePlatformRouteContext } from '@/modules/observability/application/platform-route-context';
import { HealthMetrics } from '@/modules/observability/ui/platform-administration';

export default async function PlatformHealthPage() {
  const { gateway } = await requirePlatformRouteContext();
  const health = await gateway.health();
  return (
    <section aria-labelledby="platform-health-heading">
      <h2 className="text-3xl font-black" id="platform-health-heading">
        System health
      </h2>
      <p className="mb-6 mt-2 max-w-3xl text-[var(--color-text-muted)]">
        Aggregate queue, webhook, communication, integration, and synchronization indicators. No
        tenant payloads are included.
      </p>
      <HealthMetrics health={health} />
    </section>
  );
}
