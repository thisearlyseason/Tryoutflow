import { z } from 'zod';

import { failure, success, type AppResult } from '../../../lib/result';
import type { AuthorizationContext } from '../../organizations/application/capabilities';
import { requireCapability } from '../../organizations/application/require-capability';
import {
  CHANGE_DECISIONS_CONFIRMATION,
  decisionStatusSchema,
  rosterVersionCommandSchema,
} from '../domain/roster';
import type { ChangeDecisionGateway } from './contracts';
import { defaultRosterGateway } from './roster-dependencies';

const inputSchema = rosterVersionCommandSchema.extend({
  confirmation: z.literal(CHANGE_DECISIONS_CONFIRMATION),
  changes: z
    .array(z.strictObject({ registrationId: z.uuid(), status: decisionStatusSchema }))
    .min(1)
    .max(500),
});

export async function changeDecision(
  input: unknown,
  actor: AuthorizationContext,
  dependencies: { gateway?: ChangeDecisionGateway } = {},
): Promise<AppResult<{ version: number; changed?: boolean }, { code: string }>> {
  if (
    typeof input !== 'object' ||
    input === null ||
    !('confirmation' in input) ||
    input.confirmation !== CHANGE_DECISIONS_CONFIRMATION
  )
    return failure({ code: 'confirmation_required' });
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return failure({ code: 'invalid_decisions' });
  const data = parsed.data;
  if (new Set(data.changes.map((change) => change.registrationId)).size !== data.changes.length)
    return failure({ code: 'invalid_decisions' });
  if (
    !requireCapability(actor, 'roster:write', {
      organizationId: data.organizationId as AuthorizationContext['organizationId'],
      tryoutId: data.tryoutId,
      divisionId: data.divisionId,
    }).ok
  )
    return failure({ code: 'forbidden' });
  try {
    const result = await (dependencies.gateway ?? (await defaultRosterGateway())).change(data);
    if (result.outcome === 'changed') return success({ version: result.version });
    if (result.outcome === 'unchanged' && result.version)
      return success({ version: result.version, changed: false });
    return failure({ code: result.outcome });
  } catch {
    return failure({ code: 'unexpected' });
  }
}

export type { ChangeDecisionGateway } from './contracts';
