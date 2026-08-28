import { z } from 'zod';

import type { Clock } from '../../../lib/clock';
import { SystemClock } from '../../../lib/clock';
import type { OrganizationId } from '../../../lib/ids';
import { failure, success, type AppResult } from '../../../lib/result';
import type { AuthorizationContext } from '../../organizations/application/capabilities';
import { requireCapability } from '../../organizations/application/require-capability';
import { transitionTryout, type TryoutLifecycleAction } from '../domain/lifecycle';
import type { TryoutDraft, TryoutGateway } from '../domain/tryout';

const schema = z.object({
  organizationId: z.uuid(),
  tryoutId: z.uuid(),
  action: z.enum(['publish', 'finalize']),
});

export type UpdateTryoutStepError = {
  code: 'invalid_input' | 'forbidden' | 'not_found' | 'invalid_transition' | 'unexpected';
};

export async function updateTryoutStep(
  input: unknown,
  actor: { authorization: AuthorizationContext },
  dependencies: { gateway: TryoutGateway; clock?: Clock },
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
    const current = await dependencies.gateway.findById({
      organizationId,
      tryoutId: parsed.data.tryoutId,
    });
    if (!current) {
      return failure({ code: 'not_found' });
    }

    let status;
    try {
      status = transitionTryout(current.status, parsed.data.action as TryoutLifecycleAction);
    } catch {
      return failure({ code: 'invalid_transition' });
    }

    const now = (dependencies.clock ?? new SystemClock()).now();
    const publishedAt = status === 'published' ? now : current.publishedAt;
    if (status === 'finalized' && !publishedAt) {
      return failure({ code: 'invalid_transition' });
    }

    return success(
      await dependencies.gateway.saveStep({
        id: current.id,
        organizationId,
        status,
        publishedAt,
        finalizedAt: status === 'finalized' ? now : null,
        updatedAt: now,
      }),
    );
  } catch {
    return failure({ code: 'unexpected' });
  }
}
