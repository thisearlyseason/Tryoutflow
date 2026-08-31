import { describe, expect, it } from 'vitest';

import type {
  AnalyticsEvent,
  AnalyticsProvider,
} from '../../src/infrastructure/analytics/analytics-provider';
import { FakeAnalyticsProvider } from '../../src/infrastructure/analytics/fake-analytics-provider';
import { createCorrelationId } from '../../src/modules/observability/domain/correlation-id';

function analyticsProviderContract(
  factory: () => AnalyticsProvider & { events: readonly unknown[] },
) {
  it('records validated events deterministically in submission order', async () => {
    const correlationId = createCorrelationId();
    const events: readonly AnalyticsEvent[] = [
      {
        name: 'workflow.started',
        workflow: 'tryout_setup',
        organizationId: '11111111-1111-4111-8111-111111111111',
        correlationId,
      },
      {
        name: 'workflow.completed',
        workflow: 'tryout_setup',
        organizationId: '11111111-1111-4111-8111-111111111111',
        correlationId,
      },
    ];
    const provider = factory();
    for (const event of events) await provider.track(event);

    expect(provider.events).toEqual([
      {
        name: 'workflow.started',
        workflow: 'tryout_setup',
        organizationId: '11111111-1111-4111-8111-111111111111',
        correlationId: expect.stringMatching(/^[0-9a-f-]{36}$/u),
      },
      {
        name: 'workflow.completed',
        workflow: 'tryout_setup',
        organizationId: '11111111-1111-4111-8111-111111111111',
        correlationId: expect.stringMatching(/^[0-9a-f-]{36}$/u),
      },
    ]);
    expect(provider.events[0]).not.toBe(provider.events[1]);
  });
}

describe('FakeAnalyticsProvider contract', () => {
  analyticsProviderContract(() => new FakeAnalyticsProvider());
});
