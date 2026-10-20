import { z } from 'zod';

export type DecisionStatus =
  'undecided' | 'callback' | 'selected' | 'waitlisted' | 'released' | 'withdrawn';
export type RosterState = 'draft' | 'finalized';
export type RosterAction = 'finalize' | 'revise';

export const CHANGE_DECISIONS_CONFIRMATION = 'CONFIRM DECISIONS' as const;
export const FINALIZE_ROSTER_CONFIRMATION = 'FINALIZE ROSTER' as const;
export const REVISE_ROSTER_CONFIRMATION = 'REVISE ROSTER' as const;

export const rosterScopeSchema = z.strictObject({
  organizationId: z.uuid(),
  tryoutId: z.uuid(),
  divisionId: z.uuid(),
});

export const rosterVersionCommandSchema = rosterScopeSchema.extend({
  rosterVersionId: z.uuid(),
  expectedVersion: z.number().int().safe().positive(),
});

export const decisionStatusSchema = z.enum([
  'undecided',
  'callback',
  'selected',
  'waitlisted',
  'released',
  'withdrawn',
]);

export function transitionRoster(state: RosterState, action: RosterAction): RosterState {
  if (state === 'draft' && action === 'finalize') return 'finalized';
  if (state === 'finalized' && action === 'revise') return 'draft';
  throw new Error('invalid roster transition');
}
