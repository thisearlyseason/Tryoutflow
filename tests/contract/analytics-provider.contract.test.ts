import { describe, expect, it } from 'vitest';

import type {
  AnalyticsEvent,
  AnalyticsProvider,
} from '../../src/infrastructure/analytics/analytics-provider';
import { FakeAnalyticsProvider } from '../../src/infrastructure/analytics/fake-analytics-provider';

const events: readonly AnalyticsEvent[] = [
  {
    name: 'workflow.started',
    workflow: 'tryout_setup',
    organizationId: '11111111-1111-4111-8111-111111111111',
    correlationId: 'correlation_01HF4J8M8M4VK8TQXV0E9PKM31',
  },
  {
    name: 'workflow.completed',
    workflow: 'tryout_setup',
    organizationId: '11111111-1111-4111-8111-111111111111',
    correlationId: 'correlation_01HF4J8M8M4VK8TQXV0E9PKM31',
  },
];

function analyticsProviderContract(
  factory: () => AnalyticsProvider & { events: readonly unknown[] },
) {
  it('records validated events deterministically in submission order', async () => {
    const provider = factory();
    for (const event of events) await provider.track(event);

    expect(provider.events).toEqual(events);
    expect(provider.events).not.toBe(events);
  });
}

describe('FakeAnalyticsProvider contract', () => {
  analyticsProviderContract(() => new FakeAnalyticsProvider());
});
