import { z } from 'zod';

const common = {
  assignment_id: z.uuid(),
  evaluator_user_id: z.uuid(),
  evaluator_name: z.string().min(1),
  scope_label: z.string().min(1),
  expires_at: z.iso.datetime({ offset: true }).nullable(),
};

const projectionSchema = z.discriminatedUnion('scope_kind', [
  z.object({
    ...common,
    scope_kind: z.literal('tryout'),
    division_id: z.null(),
    session_id: z.null(),
    group_id: z.null(),
  }),
  z.object({
    ...common,
    scope_kind: z.literal('division'),
    division_id: z.uuid(),
    session_id: z.null(),
    group_id: z.null(),
  }),
  z.object({
    ...common,
    scope_kind: z.literal('session'),
    division_id: z.null(),
    session_id: z.uuid(),
    group_id: z.null(),
  }),
  z.object({
    ...common,
    scope_kind: z.literal('group'),
    division_id: z.null(),
    session_id: z.uuid(),
    group_id: z.uuid(),
  }),
]);

export function parseManageableAssignment(input: unknown) {
  const parsed = projectionSchema.safeParse(input);
  if (!parsed.success) throw new Error('Invalid staffing projection');
  return {
    assignmentId: parsed.data.assignment_id,
    evaluatorUserId: parsed.data.evaluator_user_id,
    evaluatorName: parsed.data.evaluator_name,
    scopeKind: parsed.data.scope_kind,
    scopeLabel: parsed.data.scope_label,
    expiresAt: parsed.data.expires_at,
  };
}
