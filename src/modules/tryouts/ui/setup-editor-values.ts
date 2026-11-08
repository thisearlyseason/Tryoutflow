import type { SetupConfiguration } from '../domain/setup-configuration';
import { toDateTimeLocalValue } from './tryout-basics';
export type EditorValues = Record<string, string>;
export function divisionValues(
  divisions: SetupConfiguration['divisions'],
  id: string,
): EditorValues {
  const row = divisions.find((d) => d.id === id);
  return {
    divisionId: id,
    name: row?.name ?? '',
    description: row?.description ?? '',
    minAge: String(row?.min_age ?? ''),
    maxAge: String(row?.max_age ?? ''),
  };
}
export function sessionValues(
  sessions: SetupConfiguration['sessions'],
  divisions: { id: string }[],
  positions: SetupConfiguration['positions'],
  timezone: string,
  id: string,
): EditorValues {
  const row = sessions.find((s) => s.id === id);
  return {
    sessionId: id,
    divisionId: row?.division_id ?? divisions[0]?.id ?? '',
    name: row?.name ?? '',
    startsAt: toDateTimeLocalValue(row?.starts_at ?? null, timezone),
    endsAt: toDateTimeLocalValue(row?.ends_at ?? null, timezone),
    location: row?.location ?? '',
    capacity: String(row?.capacity ?? ''),
    groupId: row?.groups[0]?.id ?? '',
    groupName: row?.groups[0]?.name ?? '',
    positionId: positions[0]?.id ?? '',
    positionName: positions[0]?.name ?? '',
  };
}
export function validEditorReferences(
  step: 'divisions' | 'sessions' | 'rubrics',
  fields: EditorValues,
  configuration: SetupConfiguration,
): boolean {
  if (step === 'rubrics')
    return configuration.sessions.some((session) => session.id === fields.sessionId);
  if (step === 'divisions')
    return !fields.divisionId || configuration.divisions.some((d) => d.id === fields.divisionId);
  const session = configuration.sessions.find((s) => s.id === fields.sessionId);
  return (
    (!fields.sessionId || Boolean(session)) &&
    configuration.divisions.some((d) => d.id === fields.divisionId) &&
    (!session || session.division_id === fields.divisionId) &&
    (!fields.groupId || Boolean(session?.groups.some((g) => g.id === fields.groupId))) &&
    (!fields.positionId || configuration.positions.some((p) => p.id === fields.positionId))
  );
}

export function rubricValues(sessions: SetupConfiguration['sessions'], id: string): EditorValues {
  const rubric = sessions.find((session) => session.id === id)?.rubric;
  return {
    sessionId: id,
    name: rubric?.name ?? '',
    categories: JSON.stringify(
      rubric?.categories ?? [{ name: '', weight: 100, scaleMin: 1, scaleMax: 5 }],
    ),
  };
}
