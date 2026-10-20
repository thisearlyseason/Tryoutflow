import { z } from 'zod';

import { createServerSupabaseClient } from '../../../infrastructure/supabase/server';
import type { OrganizationId } from '../../../lib/ids';
import { failure, success, type AppResult } from '../../../lib/result';
import type { AuthorizationContext } from '../../organizations/application/capabilities';
import { requireCapability } from '../../organizations/application/require-capability';

export const tryoutSetupSteps = [
  'basics',
  'divisions',
  'sessions',
  'registration',
  'rubrics',
  'review',
  'publish',
] as const;

export type TryoutSetupStep = (typeof tryoutSetupSteps)[number];

const schema = z.object({
  organizationId: z.uuid(),
  tryoutId: z.uuid(),
  step: z.enum(tryoutSetupSteps),
});

export type SaveTryoutSetupStepGateway = {
  save(input: {
    organizationId: OrganizationId;
    tryoutId: string;
    step: TryoutSetupStep;
  }): Promise<'saved' | 'not_found' | 'not_draft' | 'invalid_step' | 'forbidden'>;
};

export async function saveTryoutSetupStep(
  input: unknown,
  actor: { authorization: AuthorizationContext },
  dependencies: { gateway?: SaveTryoutSetupStepGateway } = {},
): Promise<
  AppResult<
    void,
    {
      code:
        'invalid_input' | 'forbidden' | 'not_found' | 'not_draft' | 'invalid_step' | 'unexpected';
    }
  >
> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return failure({ code: 'invalid_input' });
  const organizationId = parsed.data.organizationId as OrganizationId;
  if (
    !requireCapability(actor.authorization, 'tryout:write', {
      organizationId,
      tryoutId: parsed.data.tryoutId,
    }).ok
  ) {
    return failure({ code: 'forbidden' });
  }
  try {
    const outcome = await (dependencies.gateway ?? (await defaultGateway())).save({
      organizationId,
      tryoutId: parsed.data.tryoutId,
      step: parsed.data.step,
    });
    return outcome === 'saved' ? success(undefined) : failure({ code: outcome });
  } catch {
    return failure({ code: 'unexpected' });
  }
}

async function defaultGateway(): Promise<SaveTryoutSetupStepGateway> {
  const client = await createServerSupabaseClient();
  return {
    async save(input) {
      const { data, error } = await client.rpc('save_tryout_setup_step', {
        p_organization_id: input.organizationId,
        p_tryout_id: input.tryoutId,
        p_step: input.step,
      });
      if (error?.code === '42501') return 'forbidden';
      if (error || !Array.isArray(data) || data.length !== 1)
        throw error ?? new Error('Invalid setup save');
      const outcome = (data[0] as { outcome?: unknown }).outcome;
      if (
        outcome === 'saved' ||
        outcome === 'not_found' ||
        outcome === 'not_draft' ||
        outcome === 'invalid_step'
      )
        return outcome;
      throw new Error('Invalid setup save response');
    },
  };
}
