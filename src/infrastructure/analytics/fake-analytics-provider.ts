import 'server-only';

import {
  serializeAnalyticsEvent,
  type AnalyticsEvent,
  type AnalyticsProvider,
  type RecordedAnalyticsEvent,
} from './analytics-provider';

/** Deterministic, side-effect-free analytics adapter for local and contract tests. */
export class FakeAnalyticsProvider implements AnalyticsProvider {
  readonly #events: RecordedAnalyticsEvent[] = [];

  get events(): readonly RecordedAnalyticsEvent[] {
    return this.#events.map((event) => ({ ...event }));
  }

  async track(event: AnalyticsEvent): Promise<void> {
    const serialized = serializeAnalyticsEvent(event);
    if (!serialized) throw new Error('Invalid privacy-safe analytics event');
    this.#events.push(serialized);
  }
}
