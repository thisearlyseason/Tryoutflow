import { z } from 'zod';

import type { OrganizationId, UserId } from '../../../lib/ids';
import { failure, success, type AppResult } from '../../../lib/result';
import type { AuthorizationContext } from './capabilities';
import { defaultOrganizationGateway } from './organization-dependencies';
import { requireCapability } from './require-capability';
import {
  isIanaTimeZone,
  type OrganizationGateway,
  type OrganizationSettings,
} from '../domain/organization';

const schema = z
  .object({
    organizationId: z.uuid(),
    timezone: z.string().trim().min(1).max(100).optional(),
    terminology: z
      .object({
        athlete: z.string().trim().min(1).max(60),
        athletes: z.string().trim().min(1).max(60),
      })
      .strict()
      .optional(),
    sportDefaults: z.array(z.string().trim().min(1).max(60)).max(30).optional(),
    tagDefaults: z.array(z.string().trim().min(1).max(60)).max(30).optional(),
  })
  .refine((value) => Object.keys(value).length > 1);
export type UpdateOrganizationSettingsError = {
  code: 'invalid_input' | 'forbidden' | 'unexpected';
};

export async function updateOrganizationSettings(
  input: unknown,
  actor: { userId: UserId; authorization: AuthorizationContext },
  dependencies: { gateway?: OrganizationGateway } = {},
): Promise<AppResult<OrganizationSettings, UpdateOrganizationSettingsError>> {
  const parsed = schema.safeParse(input);
  if (!parsed.success || (parsed.data.timezone && !isIanaTimeZone(parsed.data.timezone)))
    return failure({ code: 'invalid_input' });
  const organizationId = parsed.data.organizationId as OrganizationId;
  if (!requireCapability(actor.authorization, 'organization:update', { organizationId }).ok)
    return failure({ code: 'forbidden' });
  try {
    return success(
      await (dependencies.gateway ?? (await defaultOrganizationGateway())).updateSettings({
        ...parsed.data,
        organizationId,
      }),
    );
  } catch {
    return failure({ code: 'unexpected' });
  }
}
