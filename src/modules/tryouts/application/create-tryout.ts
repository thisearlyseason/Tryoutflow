import { z } from 'zod';

import type { Clock } from '../../../lib/clock';
import { SystemClock } from '../../../lib/clock';
import type { OrganizationId } from '../../../lib/ids';
import { failure, success, type AppResult } from '../../../lib/result';
import type { AuthorizationContext } from '../../organizations/application/capabilities';
import { requireCapability } from '../../organizations/application/require-capability';
import { isIanaTimeZone, normalizeOrganizationSlug } from '../../organizations/domain/organization';
import { hasValidInstantRange } from '../domain/lifecycle';
import type { TryoutDraft, TryoutGateway } from '../domain/tryout';
import { parseTryoutDateTime } from '../domain/tryout-date-time';
import { defaultTryoutGateway } from './tryout-dependencies';

const schema = z
  .object({
    organizationId: z.uuid(),
    seasonId: z.uuid().optional(),
    newSeasonName: z.string().trim().min(1).max(120).optional(),
    name: z.string().trim().min(1).max(160),
    slug: z.string().trim().min(1).max(160).optional(),
    sport: z.string().trim().min(1).max(80),
    timezone: z.string().trim().min(1).max(100),
    registrationStartsAt: z.string().trim().min(1).max(50).optional(),
    registrationEndsAt: z.string().trim().min(1).max(50).optional(),
  })
  .refine((value) => Boolean(value.seasonId) !== Boolean(value.newSeasonName), {
    message: 'Select exactly one cycle',
  });

export type CreateTryoutError = {
  code: 'invalid_input' | 'invalid_time_range' | 'forbidden' | 'slug_conflict' | 'unexpected';
};

export async function createTryout(
  input: unknown,
  actor: { authorization: AuthorizationContext },
  dependencies: { gateway?: TryoutGateway; clock?: Clock } = {},
): Promise<AppResult<TryoutDraft, CreateTryoutError>> {
  const parsed = schema.safeParse(input);
  if (!parsed.success || !isIanaTimeZone(parsed.data.timezone)) {
    return failure({ code: 'invalid_input' });
  }

  const organizationId = parsed.data.organizationId as OrganizationId;
  const slug = normalizeOrganizationSlug(parsed.data.slug ?? parsed.data.name);
  if (slug.length < 3 || slug.length > 63) return failure({ code: 'invalid_input' });
  if (!requireCapability(actor.authorization, 'tryout:write', { organizationId }).ok) {
    return failure({ code: 'forbidden' });
  }

  const registrationStartsAt = parseTryoutDateTime(
    parsed.data.registrationStartsAt,
    parsed.data.timezone,
  );
  const registrationEndsAt = parseTryoutDateTime(
    parsed.data.registrationEndsAt,
    parsed.data.timezone,
  );
  if (
    (parsed.data.registrationStartsAt && !registrationStartsAt) ||
    (parsed.data.registrationEndsAt && !registrationEndsAt)
  )
    return failure({ code: 'invalid_input' });
  if (!hasValidInstantRange(registrationStartsAt, registrationEndsAt)) {
    return failure({ code: 'invalid_time_range' });
  }

  const now = (dependencies.clock ?? new SystemClock()).now();
  try {
    return success(
      await (dependencies.gateway ?? (await defaultTryoutGateway())).createDraft({
        organizationId,
        seasonId: parsed.data.seasonId ?? null,
        newSeasonName: parsed.data.newSeasonName ?? null,
        name: parsed.data.name,
        slug,
        sport: parsed.data.sport,
        timezone: parsed.data.timezone,
        status: 'draft',
        registrationStartsAt,
        registrationEndsAt,
        publishedAt: null,
        finalizedAt: null,
        version: 0,
        createdAt: now,
        updatedAt: now,
      }),
    );
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505')
      return failure({ code: 'slug_conflict' });
    return failure({ code: 'unexpected' });
  }
}
