import { z } from 'zod';

import type { Clock } from '../../../lib/clock';
import { SystemClock } from '../../../lib/clock';
import type { OrganizationId } from '../../../lib/ids';
import { failure, success, type AppResult } from '../../../lib/result';
import type { AuthorizationContext } from '../../organizations/application/capabilities';
import { requireCapability } from '../../organizations/application/require-capability';
import type { TryoutDraft, TryoutGateway } from '../domain/tryout';
import { defaultTryoutGateway } from './tryout-dependencies';

const schema = z.object({
  organizationId: z.uuid(),
  tryoutId: z.uuid(),
  expectedVersion: z.number().int().nonnegative(),
  action: z.enum(['publish', 'finalize']),
});

export type UpdateTryoutStepError = {
  code:
    'invalid_input' | 'forbidden' | 'not_found' | 'conflict' | 'invalid_transition' | 'unexpected';
};

export async function updateTryoutStep(
  input: unknown,
  actor: { authorization: AuthorizationContext },
  dependencies: { gateway?: TryoutGateway; clock?: Clock } = {},
): Promise<AppResult<TryoutDraft, UpdateTryoutStepError>> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return failure({ code: 'invalid_input' });
  }

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
    const result = await (
      dependencies.gateway ?? (await defaultTryoutGateway())
    ).transitionLifecycle({
      organizationId,
      tryoutId: parsed.data.tryoutId,
      expectedVersion: parsed.data.expectedVersion,
      action: parsed.data.action,
      requestedAt: (dependencies.clock ?? new SystemClock()).now(),
    });
    return result.kind === 'updated' ? success(result.tryout) : failure({ code: result.kind });
  } catch {
    return failure({ code: 'unexpected' });
  }
}
