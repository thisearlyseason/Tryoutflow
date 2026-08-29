import { z } from 'zod';

import { createServerSupabaseClient } from '../../../infrastructure/supabase/server';
import type { Json } from '../../../infrastructure/supabase/database.types';
import type { OrganizationId } from '../../../lib/ids';
import { failure, success, type AppResult } from '../../../lib/result';
import type { AuthorizationContext } from '../../organizations/application/capabilities';
import { requireCapability } from '../../organizations/application/require-capability';
import { tryoutSetupSteps, type TryoutSetupStep } from './save-tryout-setup-step';

const schema = z.object({
  organizationId: z.uuid(),
  tryoutId: z.uuid(),
  step: z.enum(tryoutSetupSteps),
  payload: z.record(z.string(), z.unknown()),
});

export async function saveWizardConfiguration(
  input: unknown,
  actor: { authorization: AuthorizationContext },
): Promise<AppResult<void, { code: string }>> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return failure({ code: 'invalid_input' });
  const organizationId = parsed.data.organizationId as OrganizationId;
  if (
    !requireCapability(actor.authorization, 'tryout:write', {
      organizationId,
      tryoutId: parsed.data.tryoutId,
    }).ok
  )
    return failure({ code: 'forbidden' });
  if (parsed.data.step === 'review' || parsed.data.step === 'publish')
    return failure({ code: 'invalid_input' });
  try {
    const client = await createServerSupabaseClient();
    const { data, error } = await client.rpc('save_tryout_wizard_configuration', {
      p_organization_id: organizationId,
      p_tryout_id: parsed.data.tryoutId,
      p_step: parsed.data.step,
      p_payload: parsed.data.payload as Json,
    });
    if (error) return failure({ code: error.code === '42501' ? 'forbidden' : 'unexpected' });
    const outcome = Array.isArray(data)
      ? (data[0] as { outcome?: string } | undefined)?.outcome
      : undefined;
    return outcome === 'saved' ? success(undefined) : failure({ code: outcome ?? 'unexpected' });
  } catch {
    return failure({ code: 'unexpected' });
  }
}

export function wizardPayload(step: TryoutSetupStep, formData: FormData): Record<string, unknown> {
  const text = (name: string) => String(formData.get(name) ?? '').trim();
  if (step === 'basics')
    return {
      name: text('name'),
      sport: text('sport'),
      timezone: text('timezone'),
      registrationStartsAt: text('registrationStartsAt'),
      registrationEndsAt: text('registrationEndsAt'),
    };
  if (step === 'divisions') return { name: text('name') };
  if (step === 'sessions')
    return {
      divisionId: text('divisionId'),
      name: text('name'),
      startsAt: text('startsAt'),
      endsAt: text('endsAt'),
      groupName: text('groupName'),
      positionName: text('positionName'),
    };
  if (step === 'registration') return { name: text('name'), schema: { fields: [] } };
  return { sessionId: text('sessionId'), name: text('name'), categoryName: text('categoryName') };
}
