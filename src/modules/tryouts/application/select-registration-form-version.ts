import { z } from 'zod';

import { createServerSupabaseClient } from '../../../infrastructure/supabase/server';
import type { OrganizationId } from '../../../lib/ids';
import { failure, success, type AppResult } from '../../../lib/result';
import type { AuthorizationContext } from '../../organizations/application/capabilities';
import { requireCapability } from '../../organizations/application/require-capability';

const schema = z.object({
  organizationId: z.uuid(),
  tryoutId: z.uuid(),
  registrationFormVersionId: z.uuid(),
});

export async function selectRegistrationFormVersion(
  input: unknown,
  actor: { authorization: AuthorizationContext },
): Promise<
  AppResult<
    void,
    {
      code:
        | 'invalid_input'
        | 'forbidden'
        | 'not_found'
        | 'not_draft'
        | 'invalid_version'
        | 'unexpected';
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
  )
    return failure({ code: 'forbidden' });
  try {
    const client = await createServerSupabaseClient();
    const { data, error } = await client.rpc('select_tryout_registration_form_version', {
      p_organization_id: organizationId,
      p_tryout_id: parsed.data.tryoutId,
      p_registration_form_version_id: parsed.data.registrationFormVersionId,
    });
    if (error?.code === '42501') return failure({ code: 'forbidden' });
    const outcome = Array.isArray(data)
      ? (data[0] as { outcome?: string } | undefined)?.outcome
      : undefined;
    if (outcome === 'selected') return success(undefined);
    if (outcome === 'not_found' || outcome === 'not_draft' || outcome === 'invalid_version')
      return failure({ code: outcome });
    return failure({ code: 'unexpected' });
  } catch {
    return failure({ code: 'unexpected' });
  }
}
