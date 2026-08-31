import 'server-only';

import { z } from 'zod';

import {
  correlationIdValue,
  type CorrelationId,
} from '../../modules/observability/domain/correlation-id';

export const analyticsEventNames = [
  'workflow.started',
  'workflow.completed',
  'workflow.failed',
] as const;
export const analyticsWorkflows = [
  'onboarding',
  'tryout_setup',
  'registration',
  'checkin',
  'evaluation_sync',
  'roster',
  'communication',
  'integration_export',
  'report_export',
  'billing',
] as const;

const analyticsEventBoundary = z.strictObject({
  name: z.enum(analyticsEventNames),
  workflow: z.enum(analyticsWorkflows),
  organizationId: z.uuid(),
  correlationId: z.unknown(),
});

export type AnalyticsEvent = Readonly<{
  name: (typeof analyticsEventNames)[number];
  workflow: (typeof analyticsWorkflows)[number];
  organizationId: string;
  correlationId: CorrelationId;
}>;

export type RecordedAnalyticsEvent = Readonly<Omit<AnalyticsEvent, 'correlationId'>> &
  Readonly<{ correlationId: string }>;

export function serializeAnalyticsEvent(event: unknown): RecordedAnalyticsEvent | null {
  const parsed = analyticsEventBoundary.safeParse(event);
  if (!parsed.success) return null;
  const correlationId = correlationIdValue(parsed.data.correlationId);
  if (!correlationId) return null;
  return {
    name: parsed.data.name,
    workflow: parsed.data.workflow,
    organizationId: parsed.data.organizationId,
    correlationId,
  };
}

export interface AnalyticsProvider {
  track(event: AnalyticsEvent): Promise<void>;
}
