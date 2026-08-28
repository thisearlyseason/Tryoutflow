import { z } from 'zod';

import type { Clock } from '../../../lib/clock';
import { SystemClock } from '../../../lib/clock';
import type { OrganizationId } from '../../../lib/ids';
import { failure, success, type AppResult } from '../../../lib/result';
import type { AuthorizationContext } from '../../organizations/application/capabilities';
import { requireCapability } from '../../organizations/application/require-capability';
import { isIanaTimeZone } from '../../organizations/domain/organization';
import { hasValidInstantRange } from '../domain/lifecycle';
import type { TryoutDraft, TryoutGateway } from '../domain/tryout';

const schema = z.object({
  organizationId: z.uuid(),
  seasonId: z.uuid().optional(),
  name: z.string().trim().min(1).max(160),
  sport: z.string().trim().min(1).max(80),
  timezone: z.string().trim().min(1).max(100),
  registrationStartsAt: z.iso.datetime().optional(),
  registrationEndsAt: z.iso.datetime().optional(),
});

export type CreateTryoutError = {
  code: 'invalid_input' | 'invalid_time_range' | 'forbidden' | 'unexpected';
};

export async function createTryout(
  input: unknown,
  actor: { authorization: AuthorizationContext },
  dependencies: { gateway: TryoutGateway; clock?: Clock },
): Promise<AppResult<TryoutDraft, CreateTryoutError>> {
  const parsed = schema.safeParse(input);
  if (!parsed.success || !isIanaTimeZone(parsed.data.timezone)) {
    return failure({ code: 'invalid_input' });
  }

  const organizationId = parsed.data.organizationId as OrganizationId;
  if (!requireCapability(actor.authorization, 'tryout:write', { organizationId }).ok) {
    return failure({ code: 'forbidden' });
  }

  const registrationStartsAt = parsed.data.registrationStartsAt
    ? new Date(parsed.data.registrationStartsAt)
    : null;
  const registrationEndsAt = parsed.data.registrationEndsAt
    ? new Date(parsed.data.registrationEndsAt)
    : null;
  if (!hasValidInstantRange(registrationStartsAt, registrationEndsAt)) {
    return failure({ code: 'invalid_time_range' });
  }

  const now = (dependencies.clock ?? new SystemClock()).now();
  try {
    return success(
      await dependencies.gateway.createDraft({
        organizationId,
        seasonId: parsed.data.seasonId ?? null,
        name: parsed.data.name,
        sport: parsed.data.sport,
        timezone: parsed.data.timezone,
        status: 'draft',
        registrationStartsAt,
        registrationEndsAt,
        publishedAt: null,
        finalizedAt: null,
        createdAt: now,
        updatedAt: now,
      }),
    );
  } catch {
    return failure({ code: 'unexpected' });
  }
}
