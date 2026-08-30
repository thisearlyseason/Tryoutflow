import { z } from 'zod';

/** The byte-authoritative renderer is private.render_decision_message_payload in migration 065. */
export const decisionMessageKindSchema = z.enum(['callback', 'selected', 'waitlisted', 'released']);
export type DecisionMessageKind = z.infer<typeof decisionMessageKindSchema>;

export function parseDecisionMessageKind(input: unknown): DecisionMessageKind {
  return decisionMessageKindSchema.parse(input);
}
