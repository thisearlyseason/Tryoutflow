import 'server-only';

import { z } from 'zod';

const correlationIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u);

export const analyticsEventSchema = z
  .object({
    name: z.enum(['workflow.started', 'workflow.completed', 'workflow.failed']),
    workflow: z.enum([
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
    ]),
    organizationId: z.uuid(),
    correlationId: correlationIdSchema,
  })
  .strict();

export type AnalyticsEvent = z.infer<typeof analyticsEventSchema>;

export interface AnalyticsProvider {
  track(event: AnalyticsEvent): Promise<void>;
}
