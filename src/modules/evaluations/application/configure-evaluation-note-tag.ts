import { z } from 'zod';

import { failure, success, type AppResult } from '../../../lib/result';
import type { AuthorizationContext } from '../../organizations/application/capabilities';
import { requireCapability } from '../../organizations/application/require-capability';
import type { ConfigureEvaluationNoteTagGateway } from './contracts';
import { defaultEvaluationGateway } from './evaluation-dependencies';

const schema = z.strictObject({
  organizationId: z.uuid(),
  noteTagId: z.uuid().nullable(),
  label: z.string().trim().min(1).max(80),
  active: z.boolean(),
});

export async function configureEvaluationNoteTag(
  input: unknown,
  actor: AuthorizationContext,
  dependencies: { gateway?: ConfigureEvaluationNoteTagGateway } = {},
): Promise<AppResult<{ noteTagId: string }, { code: string }>> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return failure({ code: 'invalid_input' });
  if (
    !requireCapability(actor, 'organization:update', {
      organizationId: parsed.data.organizationId as AuthorizationContext['organizationId'],
    }).ok
  )
    return failure({ code: 'forbidden' });
  try {
    const result = await (dependencies.gateway ?? (await defaultEvaluationGateway())).configure(
      parsed.data,
    );
    return result.outcome === 'saved'
      ? success({ noteTagId: result.noteTagId })
      : failure({ code: result.outcome });
  } catch {
    return failure({ code: 'unexpected' });
  }
}

export type { ConfigureEvaluationNoteTagGateway } from './contracts';
