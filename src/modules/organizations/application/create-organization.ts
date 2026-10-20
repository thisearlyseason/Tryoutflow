import { z } from 'zod';

import { failure, success, type AppResult } from '../../../lib/result';
import { defaultOrganizationGateway } from './organization-dependencies';
import {
  defaultOrganizationTerminology,
  isIanaTimeZone,
  normalizeOrganizationSlug,
  type Organization,
  type OrganizationGateway,
  type OrganizationMembership,
} from '../domain/organization';
import type { UserId } from '../../../lib/ids';

const schema = z.object({
  name: z.string().trim().min(1).max(160),
  slug: z.string().min(1).max(160),
  timezone: z.string().trim().min(1).max(100),
  terminology: z.record(z.string(), z.string().trim().min(1).max(60)).optional(),
  sportDefaults: z.array(z.string().trim().min(1).max(60)).max(30).optional(),
  tagDefaults: z.array(z.string().trim().min(1).max(60)).max(30).optional(),
});

export type CreateOrganizationError = { code: 'invalid_input' | 'slug_conflict' | 'unexpected' };
export type CreateOrganizationSuccess = {
  organization: Organization;
  membership: OrganizationMembership;
};

export async function createOrganization(
  input: unknown,
  actor: { userId: UserId },
  dependencies: { gateway?: OrganizationGateway } = {},
): Promise<AppResult<CreateOrganizationSuccess, CreateOrganizationError>> {
  const parsed = schema.safeParse(input);
  const slug = parsed.success ? normalizeOrganizationSlug(parsed.data.slug) : '';
  if (
    !parsed.success ||
    !isIanaTimeZone(parsed.data.timezone) ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) ||
    slug.length < 3 ||
    slug.length > 63
  )
    return failure({ code: 'invalid_input' });
  try {
    const result = await (
      dependencies.gateway ?? (await defaultOrganizationGateway())
    ).createWithOwner({
      name: parsed.data.name,
      slug,
      timezone: parsed.data.timezone,
      terminology: parsed.data.terminology ?? { ...defaultOrganizationTerminology },
      sportDefaults: parsed.data.sportDefaults ?? [],
      tagDefaults: parsed.data.tagDefaults ?? [],
    });
    if ('kind' in result) return failure({ code: 'slug_conflict' });
    if (result.membership.userId !== actor.userId) throw new Error('Owner mismatch');
    return success(result);
  } catch {
    return failure({ code: 'unexpected' });
  }
}
