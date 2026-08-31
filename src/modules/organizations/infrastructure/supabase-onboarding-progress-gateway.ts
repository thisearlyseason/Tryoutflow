import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';

import type { Database } from '../../../infrastructure/supabase/database.types';
import {
  deriveOnboardingProgress,
  type OnboardingFacts,
  type OnboardingProgress,
} from '../application/onboarding-progress';

const response = z.strictObject({
  outcome: z.enum(['ok', 'forbidden']),
  facts: z
    .strictObject({
      organizationExists: z.boolean(),
      settingsConfigured: z.boolean(),
      registrationConfigured: z.boolean(),
      activeStaffCount: z.number().int().min(0).max(100_000),
      publishedRubricCount: z.number().int().min(0).max(100_000),
      sessionCount: z.number().int().min(0).max(100_000),
      completedEvaluationCount: z.number().int().min(0).max(10_000_000),
      finalizedRosterCount: z.number().int().min(0).max(1_000_000),
    })
    .optional(),
});

export function parseOnboardingFacts(input: unknown): OnboardingFacts | null {
  const parsed = response.safeParse(input);
  if (!parsed.success) throw new Error('Invalid onboarding projection');
  return parsed.data.outcome === 'ok' && parsed.data.facts ? parsed.data.facts : null;
}

export class SupabaseOnboardingProgressGateway {
  constructor(private readonly client: SupabaseClient<Database>) {}

  async load(organizationId: string): Promise<OnboardingProgress | null> {
    const { data, error } = await this.client.rpc('load_onboarding_facts', {
      p_organization_id: organizationId,
    });
    if (error || !Array.isArray(data) || data.length !== 1)
      throw error ?? new Error('Invalid onboarding projection');
    const facts = parseOnboardingFacts(data[0]?.result);
    return facts ? deriveOnboardingProgress(facts) : null;
  }
}
