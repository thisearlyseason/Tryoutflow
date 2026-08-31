import { requirePlatformRouteContext } from '@/modules/observability/application/platform-route-context';
import { SubscriptionDirectory } from '@/modules/observability/ui/platform-administration';

export default async function PlatformSubscriptionsPage() {
  const { gateway } = await requirePlatformRouteContext();
  const subscriptions = await gateway.listSubscriptions();
  return (
    <section aria-labelledby="platform-subscriptions-heading">
      <h2 className="text-3xl font-black" id="platform-subscriptions-heading">
        Subscriptions
      </h2>
      <p className="mb-6 mt-2 max-w-3xl text-[var(--color-text-muted)]">
        Verified entitlement state without provider customer identifiers, secrets, or webhook
        payloads.
      </p>
      <SubscriptionDirectory subscriptions={subscriptions} />
    </section>
  );
}
