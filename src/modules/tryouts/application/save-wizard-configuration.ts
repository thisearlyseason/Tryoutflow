import { z } from 'zod';

import { createServerSupabaseClient } from '../../../infrastructure/supabase/server';
import type { Json } from '../../../infrastructure/supabase/database.types';
import type { OrganizationId } from '../../../lib/ids';
import { failure, success, type AppResult } from '../../../lib/result';
import type { AuthorizationContext } from '../../organizations/application/capabilities';
import { isIanaTimeZone } from '../../organizations/domain/organization';
import { requireCapability } from '../../organizations/application/require-capability';
import { hasValidInstantRange } from '../domain/lifecycle';
import { parseTryoutDateTime } from '../domain/tryout-date-time';
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
    let payload = parsed.data.payload;
    if (parsed.data.step === 'basics') {
      const timezone = payload.timezone;
      const startsAt = payload.registrationStartsAt;
      const endsAt = payload.registrationEndsAt;
      if (
        typeof timezone !== 'string' ||
        !isIanaTimeZone(timezone) ||
        typeof startsAt !== 'string' ||
        typeof endsAt !== 'string'
      )
        return failure({ code: 'invalid_input' });
      const startInstant = parseTryoutDateTime(startsAt, timezone);
      const endInstant = parseTryoutDateTime(endsAt, timezone);
      if (!startInstant || !endInstant || !hasValidInstantRange(startInstant, endInstant))
        return failure({ code: 'invalid_input' });
      payload = {
        ...payload,
        registrationStartsAt: startInstant.toISOString(),
        registrationEndsAt: endInstant.toISOString(),
      };
    } else if (parsed.data.step === 'sessions') {
      const timezoneResult = await client
        .from('tryouts')
        .select('timezone')
        .eq('organization_id', organizationId)
        .eq('id', parsed.data.tryoutId)
        .maybeSingle();
      const timezone = timezoneResult.data?.timezone;
      const startsAt = payload.startsAt;
      const endsAt = payload.endsAt;
      if (
        timezoneResult.error ||
        typeof timezone !== 'string' ||
        !isIanaTimeZone(timezone) ||
        typeof startsAt !== 'string' ||
        typeof endsAt !== 'string'
      )
        return failure({ code: 'invalid_input' });
      const startInstant = parseTryoutDateTime(startsAt, timezone);
      const endInstant = parseTryoutDateTime(endsAt, timezone);
      if (!startInstant || !endInstant || !hasValidInstantRange(startInstant, endInstant))
        return failure({ code: 'invalid_input' });
      payload = {
        ...payload,
        startsAt: startInstant.toISOString(),
        endsAt: endInstant.toISOString(),
      };
    }
    const { data, error } = await client.rpc('save_tryout_wizard_configuration', {
      p_organization_id: organizationId,
      p_tryout_id: parsed.data.tryoutId,
      p_step: parsed.data.step,
      p_payload: payload as Json,
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
