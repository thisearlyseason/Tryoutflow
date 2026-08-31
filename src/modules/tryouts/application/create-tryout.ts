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
import { defaultTryoutGateway } from './tryout-dependencies';

const schema = z.object({
  organizationId: z.uuid(),
  seasonId: z.uuid().optional(),
  name: z.string().trim().min(1).max(160),
  slug: z.string().trim().min(1).max(160).optional(),
  sport: z.string().trim().min(1).max(80),
  timezone: z.string().trim().min(1).max(100),
  registrationStartsAt: z.string().trim().min(1).max(50).optional(),
  registrationEndsAt: z.string().trim().min(1).max(50).optional(),
});

const browserLocalDateTime =
  /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})T(?<hour>\d{2}):(?<minute>\d{2})(?::(?<second>\d{2}))?$/u;

function zonedParts(timestamp: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(timestamp);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  return {
    year: value('year'),
    month: value('month'),
    day: value('day'),
    hour: value('hour'),
    minute: value('minute'),
    second: value('second'),
  };
}

function parseTryoutDateTime(value: string | undefined, timeZone: string): Date | null {
  if (!value) return null;
  if (z.iso.datetime({ offset: true }).safeParse(value).success) return new Date(value);
  const match = browserLocalDateTime.exec(value);
  if (!match?.groups) return null;
  const desired = {
    year: Number(match.groups.year),
    month: Number(match.groups.month),
    day: Number(match.groups.day),
    hour: Number(match.groups.hour),
    minute: Number(match.groups.minute),
    second: Number(match.groups.second ?? '0'),
  };
  const localAsUtc = Date.UTC(
    desired.year,
    desired.month - 1,
    desired.day,
    desired.hour,
    desired.minute,
    desired.second,
  );
  if (
    !Object.entries(desired).every(
      ([part, expected]) =>
        ({
          year: new Date(localAsUtc).getUTCFullYear(),
          month: new Date(localAsUtc).getUTCMonth() + 1,
          day: new Date(localAsUtc).getUTCDate(),
          hour: new Date(localAsUtc).getUTCHours(),
          minute: new Date(localAsUtc).getUTCMinutes(),
          second: new Date(localAsUtc).getUTCSeconds(),
        })[part as keyof typeof desired] === expected,
    )
  )
    return null;
  let candidate = localAsUtc;
  for (let pass = 0; pass < 2; pass += 1) {
    const parts = zonedParts(candidate, timeZone);
    const representedAsUtc = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    );
    candidate = localAsUtc - (representedAsUtc - candidate);
  }
  const roundTrip = zonedParts(candidate, timeZone);
  return Object.entries(desired).every(
    ([part, expected]) => roundTrip[part as keyof typeof roundTrip] === expected,
  )
    ? new Date(candidate)
    : null;
}

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
