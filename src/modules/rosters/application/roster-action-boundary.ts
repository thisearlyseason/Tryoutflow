import { z } from 'zod';

import { decisionStatusSchema } from '../domain/roster';

const id = z.uuid();
const version = z.number().int().safe().positive();
const team = z.strictObject({
  name: z.string().trim().min(1).max(120),
  targetSize: z.number().int().min(1).max(500).nullable(),
  positionTargets: z.record(id, z.number().int().min(0).max(500)),
});
const createInput = z.strictObject({ teams: z.array(team).min(1).max(50) });
const moveInput = z.strictObject({
  rosterVersionId: id,
  registrationId: id,
  teamId: id.nullable(),
  expectedVersion: version,
});
const changeInput = z.strictObject({
  rosterVersionId: id,
  changes: z
    .array(z.strictObject({ registrationId: id, status: decisionStatusSchema }))
    .min(1)
    .max(500),
  expectedVersion: version,
});
const finalizeInput = z.strictObject({ rosterVersionId: id, expectedVersion: version });
const reviseInput = z.strictObject({
  rosterVersionId: id,
  expectedVersion: version,
  reason: z.string().trim().min(10).max(500),
});

export type RosterActionScope = Readonly<{
  organizationId: string;
  tryoutId: string;
  divisionId: string;
}>;

type Bound<T> = { ok: true; data: T } | { ok: false };

function parse<T>(schema: z.ZodType<T>, input: unknown): T | null {
  try {
    const result = schema.safeParse(input);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

export function bindCreateRosterActionInput(
  input: unknown,
  scope: RosterActionScope,
): Bound<{
  organizationId: string;
  tryoutId: string;
  divisionId: string;
  teams: z.infer<typeof createInput>['teams'];
}> {
  const data = parse(createInput, input);
  if (!data) return { ok: false };
  return {
    ok: true,
    data: {
      organizationId: scope.organizationId,
      tryoutId: scope.tryoutId,
      divisionId: scope.divisionId,
      teams: data.teams,
    },
  };
}

export function bindMoveRosterActionInput(
  input: unknown,
  scope: RosterActionScope,
): Bound<{
  organizationId: string;
  tryoutId: string;
  divisionId: string;
  rosterVersionId: string;
  registrationId: string;
  teamId: string | null;
  expectedVersion: number;
}> {
  const data = parse(moveInput, input);
  if (!data) return { ok: false };
  return {
    ok: true,
    data: {
      organizationId: scope.organizationId,
      tryoutId: scope.tryoutId,
      divisionId: scope.divisionId,
      rosterVersionId: data.rosterVersionId,
      registrationId: data.registrationId,
      teamId: data.teamId,
      expectedVersion: data.expectedVersion,
    },
  };
}

export function bindChangeRosterActionInput(
  input: unknown,
  scope: RosterActionScope,
): Bound<{
  organizationId: string;
  tryoutId: string;
  divisionId: string;
  rosterVersionId: string;
  changes: z.infer<typeof changeInput>['changes'];
  expectedVersion: number;
}> {
  const data = parse(changeInput, input);
  if (!data) return { ok: false };
  return {
    ok: true,
    data: {
      organizationId: scope.organizationId,
      tryoutId: scope.tryoutId,
      divisionId: scope.divisionId,
      rosterVersionId: data.rosterVersionId,
      changes: data.changes,
      expectedVersion: data.expectedVersion,
    },
  };
}

export function bindFinalizeRosterActionInput(
  input: unknown,
  scope: RosterActionScope,
): Bound<{
  organizationId: string;
  tryoutId: string;
  divisionId: string;
  rosterVersionId: string;
  expectedVersion: number;
}> {
  const data = parse(finalizeInput, input);
  if (!data) return { ok: false };
  return {
    ok: true,
    data: {
      organizationId: scope.organizationId,
      tryoutId: scope.tryoutId,
      divisionId: scope.divisionId,
      rosterVersionId: data.rosterVersionId,
      expectedVersion: data.expectedVersion,
    },
  };
}

export function bindReviseRosterActionInput(
  input: unknown,
  scope: RosterActionScope,
): Bound<{
  organizationId: string;
  tryoutId: string;
  divisionId: string;
  rosterVersionId: string;
  expectedVersion: number;
  reason: string;
}> {
  const data = parse(reviseInput, input);
  if (!data) return { ok: false };
  return {
    ok: true,
    data: {
      organizationId: scope.organizationId,
      tryoutId: scope.tryoutId,
      divisionId: scope.divisionId,
      rosterVersionId: data.rosterVersionId,
      expectedVersion: data.expectedVersion,
      reason: data.reason,
    },
  };
}
