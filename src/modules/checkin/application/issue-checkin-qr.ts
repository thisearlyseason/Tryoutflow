import { z } from 'zod';

import { createServerSupabaseClient } from '../../../infrastructure/supabase/server';
import type { OrganizationId } from '../../../lib/ids';
import { failure, success, type AppResult } from '../../../lib/result';
import type { AuthorizationContext } from '../../organizations/application/capabilities';
import { requireCapability } from '../../organizations/application/require-capability';

const schema = z.object({
  organizationId: z.uuid(),
  tryoutId: z.uuid(),
  registrationId: z.uuid(),
});

export async function issueCheckinQr(
  input: unknown,
  actor: { authorization: AuthorizationContext },
  dependencies: {
    issue?: (input: {
      organizationId: string;
      tryoutId: string;
      registrationId: string;
    }) => Promise<string | null>;
  } = {},
): Promise<AppResult<{ token: string }, { code: 'invalid_input' | 'forbidden' | 'unavailable' }>> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return failure({ code: 'invalid_input' });
  const organizationId = parsed.data.organizationId as OrganizationId;
  if (
    !requireCapability(actor.authorization, 'checkin:write', {
      organizationId,
      tryoutId: parsed.data.tryoutId,
    }).ok
  )
    return failure({ code: 'forbidden' });
  try {
    const issue =
      dependencies.issue ??
      (async (command) => {
        const client = await createServerSupabaseClient();
        const result = await client.rpc('issue_checkin_qr_token', {
          p_organization_id: command.organizationId,
          p_tryout_id: command.tryoutId,
          p_registration_id: command.registrationId,
        });
        if (result.error) throw result.error;
        return result.data;
      });
    const token = await issue(parsed.data);
    return token && /^[0-9a-f]{64}$/u.test(token)
      ? success({ token })
      : failure({ code: 'unavailable' });
  } catch {
    return failure({ code: 'unavailable' });
  }
}
