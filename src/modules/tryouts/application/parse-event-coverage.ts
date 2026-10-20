import { z } from 'zod';

const timestamp = z.iso.datetime({ offset: true });
const projection = z.array(
  z.object({
    athlete_id: z.uuid(),
    registration_id: z.uuid(),
    name: z.string(),
    session_id: z.uuid(),
    session: z.string(),
    group: z.string().nullable(),
    starts_at: timestamp,
    ends_at: timestamp,
    checked_in_at: timestamp.nullable(),
    evaluators: z.array(
      z.object({
        user_id: z.uuid(),
        name: z.string(),
        state: z.enum(['not_started', 'draft', 'completed', 'locked', 'reopened']),
        updated_at: timestamp.nullable(),
        evaluation_id: z.uuid().nullable(),
        latest_sync_outcome: z.string().nullable(),
      }),
    ),
  }),
);

/** An unavailable or malformed snapshot must never be presented as zero placements. */
export function parseEventCoverage(value: unknown) {
  const result = projection.safeParse(value);
  return result.success ? result.data : null;
}
