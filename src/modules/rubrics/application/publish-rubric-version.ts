import { z } from 'zod';

import { createServerSupabaseClient } from '../../../infrastructure/supabase/server';
import type { OrganizationId } from '../../../lib/ids';
import { failure, success, type AppResult } from '../../../lib/result';
import type { AuthorizationContext } from '../../organizations/application/capabilities';
import { requireCapability } from '../../organizations/application/require-capability';

const inputSchema = z.object({
  organizationId: z.uuid(),
  tryoutId: z.uuid(),
  rubricId: z.uuid(),
  expectedVersion: z.number().int().positive(),
});

export type PublishRubricVersionError = {
  code: 'invalid_input' | 'forbidden' | 'not_found' | 'conflict' | 'invalid_draft' | 'unexpected';
};

export type PublishRubricVersionGateway = {
  publish(input: {
    organizationId: OrganizationId;
    rubricId: string;
    expectedVersion: number;
  }): Promise<
    { kind: 'published'; versionId: string } | { kind: 'not_found' | 'conflict' | 'invalid_draft' }
  >;
};

export async function publishRubricVersion(
  input: unknown,
  actor: { authorization: AuthorizationContext },
  dependencies: { gateway?: PublishRubricVersionGateway } = {},
): Promise<AppResult<{ versionId: string }, PublishRubricVersionError>> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return failure({ code: 'invalid_input' });

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
    const result = await (dependencies.gateway ?? (await defaultRubricVersionGateway())).publish({
      organizationId,
      rubricId: parsed.data.rubricId,
      expectedVersion: parsed.data.expectedVersion,
    });
    return result.kind === 'published'
      ? success({ versionId: result.versionId })
      : failure({ code: result.kind });
  } catch {
    return failure({ code: 'unexpected' });
  }
}

async function defaultRubricVersionGateway(): Promise<PublishRubricVersionGateway> {
  const client = await createServerSupabaseClient();
  return {
    async publish(input) {
      const { data, error } = await client.rpc('publish_rubric_version', {
        p_organization_id: input.organizationId,
        p_rubric_id: input.rubricId,
        p_expected_version: input.expectedVersion,
      });
      if (error) throw error;
      const result = data?.[0];
      if (!result || result.outcome === 'not_found') {
        return { kind: 'not_found' as const };
      }
      if (result.outcome === 'conflict') {
        return { kind: 'conflict' as const };
      }
      if (result.outcome === 'invalid_draft') {
        return { kind: 'invalid_draft' as const };
      }
      return { kind: 'published', versionId: result.version_id };
    },
  };
}
