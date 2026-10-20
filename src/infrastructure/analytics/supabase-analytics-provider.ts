import 'server-only';

import { AppError } from '../../modules/observability/domain/app-error';
import { captureOperationalError } from '../observability/server-observability';
import {
  serializeAnalyticsEvent,
  type AnalyticsEvent,
  type AnalyticsProvider,
} from './analytics-provider';

type AnalyticsRpcClient = {
  rpc(
    name: 'enqueue_analytics_event',
    args: {
      p_organization_id: string;
      p_event_name: string;
      p_workflow: string;
      p_correlation_id: string;
    },
  ): PromiseLike<{ data: unknown; error: unknown }>;
};

export class SupabaseAnalyticsProvider implements AnalyticsProvider {
  constructor(private readonly client: AnalyticsRpcClient) {}

  async track(event: AnalyticsEvent): Promise<void> {
    const serialized = serializeAnalyticsEvent(event);
    if (!serialized) throw new Error('Invalid privacy-safe analytics event');
    const result = await this.client.rpc('enqueue_analytics_event', {
      p_organization_id: serialized.organizationId,
      p_event_name: serialized.name,
      p_workflow: serialized.workflow,
      p_correlation_id: serialized.correlationId,
    });
    const row = Array.isArray(result.data) ? result.data[0] : result.data;
    const outcome =
      row && typeof row === 'object' && 'outcome' in row
        ? String((row as { outcome: unknown }).outcome)
        : '';
    if (result.error || !['queued', 'replayed'].includes(outcome))
      throw new AppError('integration_unavailable');
  }
}

type FailureCapture = (error: unknown, context: Readonly<Record<string, unknown>>) => void;

/** Analytics is best-effort after persistence; sink failures are logged but never rethrown. */
export async function trackWorkflowSafely(
  provider: AnalyticsProvider,
  event: AnalyticsEvent,
  capture: FailureCapture = captureOperationalError,
): Promise<void> {
  try {
    await provider.track(event);
  } catch (error) {
    try {
      capture(error, {
        organizationId: event.organizationId,
        correlationId: event.correlationId,
        operation: 'analytics.enqueue',
      });
    } catch {
      // Both sinks are secondary to the completed application write.
    }
  }
}

export async function trackSupabaseWorkflowSafely(
  client: AnalyticsRpcClient,
  event: AnalyticsEvent,
): Promise<void> {
  await trackWorkflowSafely(new SupabaseAnalyticsProvider(client), event);
}
