import 'server-only';

import {
  analyticsEventSchema,
  type AnalyticsEvent,
  type AnalyticsProvider,
} from './analytics-provider';

/** Deterministic, side-effect-free analytics adapter for local and contract tests. */
export class FakeAnalyticsProvider implements AnalyticsProvider {
  readonly #events: AnalyticsEvent[] = [];

  get events(): readonly AnalyticsEvent[] {
    return this.#events.map((event) => ({ ...event }));
  }

  async track(event: AnalyticsEvent): Promise<void> {
    const parsed = analyticsEventSchema.safeParse(event);
    if (!parsed.success) throw new Error('Invalid privacy-safe analytics event');
    this.#events.push({ ...parsed.data });
  }
}
