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
  code:
    | 'invalid_input'
    | 'forbidden'
    | 'not_found'
    | 'conflict'
    | 'invalid_draft'
    | 'capacity'
    | 'unexpected';
};

export type PublishRubricVersionOutcome =
  | { kind: 'published'; versionId: string }
  | { kind: 'not_found' | 'conflict' | 'invalid_draft' | 'capacity' | 'forbidden' | 'unexpected' };

export type PublishRubricVersionGateway = {
  publish(input: {
    organizationId: OrganizationId;
    rubricId: string;
    expectedVersion: number;
  }): Promise<PublishRubricVersionOutcome>;
};

type RpcRow = { outcome?: unknown; version_id?: unknown };
type RpcError = { code?: unknown } | null;

export function mapPublishRubricVersionResponse(
  data: unknown,
  error: RpcError,
): PublishRubricVersionOutcome {
  if (error?.code === '42501') return { kind: 'forbidden' };
  if (error) return { kind: 'unexpected' };
  if (
    !Array.isArray(data) ||
    data.length !== 1 ||
    typeof data[0] !== 'object' ||
    data[0] === null
  ) {
    return { kind: 'unexpected' };
  }
  const row = data[0] as RpcRow;
  if (row.outcome === 'published' && typeof row.version_id === 'string') {
    return { kind: 'published', versionId: row.version_id };
  }
  if (
    row.outcome === 'not_found' ||
    row.outcome === 'conflict' ||
    row.outcome === 'invalid_draft' ||
    row.outcome === 'capacity'
  ) {
    return { kind: row.outcome };
  }
  return { kind: 'unexpected' };
}

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
      return mapPublishRubricVersionResponse(data, error);
    },
  };
}
