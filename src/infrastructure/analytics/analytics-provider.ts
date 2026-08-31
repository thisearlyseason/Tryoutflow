import 'server-only';

import { z } from 'zod';

import {
  correlationIdValue,
  type CorrelationId,
} from '../../modules/observability/domain/correlation-id';
import { snapshotOwnPrimitives } from '../../modules/observability/domain/primitive-snapshot';

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
  correlationId: z.uuid(),
});

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

const analyticsEventNormalizers = {
  name: stringValue,
  workflow: stringValue,
  organizationId: stringValue,
  correlationId: (value: unknown) => correlationIdValue(value) ?? undefined,
} as const;

export type AnalyticsEvent = Readonly<{
  name: (typeof analyticsEventNames)[number];
  workflow: (typeof analyticsWorkflows)[number];
  organizationId: string;
  correlationId: CorrelationId;
}>;

export type RecordedAnalyticsEvent = Readonly<Omit<AnalyticsEvent, 'correlationId'>> &
  Readonly<{ correlationId: string }>;

export function serializeAnalyticsEvent(event: unknown): RecordedAnalyticsEvent | null {
  const snapshot = snapshotOwnPrimitives(event, analyticsEventNormalizers, {
    rejectUnknownKeys: true,
  });
  if (!snapshot) return null;
  let parsed: ReturnType<typeof analyticsEventBoundary.safeParse>;
  try {
    parsed = analyticsEventBoundary.safeParse(snapshot);
  } catch {
    return null;
  }
  if (!parsed.success) return null;
  return {
    name: parsed.data.name,
    workflow: parsed.data.workflow,
    organizationId: parsed.data.organizationId,
    correlationId: parsed.data.correlationId,
  };
}

export interface AnalyticsProvider {
  track(event: AnalyticsEvent): Promise<void>;
}
