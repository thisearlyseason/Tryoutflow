import { z } from 'zod';

const text = (max: number) => z.string().trim().max(max);
const required = (max: number) => text(max).min(1, 'This field is required.');
const nullableNumber = z.preprocess(
  (v) => (v === '' || v === undefined || v === null ? null : Number(v)),
  z.number().finite().nullable(),
);
const nullableId = z.preprocess(
  (v) => (v === '' || v === undefined ? null : v),
  z.uuid().nullable(),
);
const timestamp = z.iso.datetime({ offset: true }).transform((v) => new Date(v).toISOString());
const nullableTimestamp = z.preprocess(
  (v) => (v === '' || v === undefined ? null : v),
  timestamp.nullable(),
);
const date = z.preprocess((v) => (v === '' || v === undefined ? null : v), z.iso.date().nullable());
const boolean = z.preprocess((v) => v === true || v === 'on' || v === 'true', z.boolean());
const url = z.preprocess(
  (v) => (v === '' || v === undefined ? null : v),
  z
    .url()
    .max(2000)
    .refine((v) => {
      const u = new URL(v);
      return u.protocol === 'https:' && !u.username && !u.password;
    }, 'Use a public HTTPS video link without credentials.')
    .nullable(),
);

export const profileSchema = z.strictObject({
  athlete_id: z.uuid(),
  preferred_name: text(120),
  sport: text(80),
  primary_position: text(120),
  secondary_positions: text(300),
  current_team: text(160),
  competitive_level: text(120),
  dominant_side: text(80),
  hometown: text(160),
  biography: text(4000),
  tags: text(500),
  stage: z.enum([
    'identified',
    'observe',
    'follow_up',
    'invited',
    'evaluating',
    'selected',
    'monitor',
    'closed',
  ]),
});
export const evaluatorSchema = z.strictObject({
  user_id: z.uuid(),
  display_name: required(120),
  sport: text(80),
  specialties: text(500),
  qualifications: text(2000),
  experience: text(4000),
  availability: text(2000),
  conflict_disclosure: text(2000),
  briefing_complete: boolean,
  affiliation: text(200).default(''),
  device_check_complete: boolean.default(false),
  assignments_acknowledged: boolean.default(false),
});
export const metricSchema = z
  .strictObject({
    name: required(120),
    sport: required(80),
    unit: required(30),
    value_kind: z.enum(['decimal', 'duration', 'distance', 'speed', 'count', 'ratio']),
    direction: z.enum(['higher', 'lower', 'neutral']),
    aggregation: z.enum(['best', 'mean', 'latest']),
    protocol: required(2000),
    minimum: nullableNumber,
    maximum: nullableNumber,
  })
  .refine((v) => v.minimum === null || v.maximum === null || v.minimum <= v.maximum, {
    message: 'Minimum must not exceed maximum.',
    path: ['maximum'],
  })
  .refine((v) => v.value_kind !== 'ratio' || v.unit === '%', {
    message: 'Ratio metrics use percent (%).',
    path: ['unit'],
  })
  .refine((v) => v.direction !== 'neutral' || v.aggregation !== 'best', {
    message: 'Descriptive metrics use mean or latest.',
    path: ['aggregation'],
  });
export const resultSchema = z
  .strictObject({
    athlete_id: z.uuid(),
    metric_id: z.uuid(),
    session_id: nullableId,
    value: nullableNumber,
    numerator: nullableNumber,
    denominator: nullableNumber,
    status: z.enum(['valid', 'invalid', 'not_observed', 'did_not_participate']),
    trial: z.coerce.number().int().min(1).max(1000),
    measured_at: timestamp,
    source: required(300),
    verified: boolean,
    note: text(2000),
  })
  .superRefine((v, ctx) => {
    if (
      v.status === 'valid' &&
      v.value === null &&
      (v.numerator === null || v.denominator === null)
    )
      ctx.addIssue({
        code: 'custom',
        path: ['value'],
        message: 'Record a value, or successes and attempts.',
      });
    if (
      v.denominator !== null &&
      (v.denominator <= 0 || v.numerator === null || v.numerator < 0 || v.numerator > v.denominator)
    )
      ctx.addIssue({
        code: 'custom',
        path: ['denominator'],
        message: 'Attempts must be positive and at least the number of successes.',
      });
    if (
      [v.numerator, v.denominator].some(
        (n) => n !== null && (!Number.isInteger(n) || n > 1000000000),
      )
    )
      ctx.addIssue({
        code: 'custom',
        path: ['denominator'],
        message: 'Use whole counts up to one billion.',
      });
    if (Date.parse(v.measured_at) > Date.now() + 300000)
      ctx.addIssue({
        code: 'custom',
        path: ['measured_at'],
        message: 'Results cannot be dated in the future.',
      });
  })
  .transform((v) =>
    v.status === 'valid'
      ? {
          ...v,
          value:
            v.numerator !== null && v.denominator !== null
              ? Math.round((v.numerator / v.denominator) * 100000000) / 1000000
              : v.value,
        }
      : { ...v, value: null, numerator: null, denominator: null },
  );
export const recordSchema = z
  .strictObject({
    athlete_id: z.uuid(),
    kind: z.enum(['report', 'task', 'video', 'goal', 'watchlist']),
    title: required(160),
    observation_type: z.enum(['live', 'video', 'training', 'other']).default('live'),
    event_context: text(500).default(''),
    criterion: text(300).default(''),
    review_feedback: text(4000).default(''),
    body: text(8000),
    status: z.enum(['draft', 'active', 'in_review', 'approved', 'complete', 'archived']),
    visibility: z.enum(['private', 'staff', 'athlete']),
    observed_at: nullableTimestamp,
    due_on: date,
    assigned_user_id: nullableId,
    source: text(300),
    strengths: text(4000),
    development_areas: text(4000),
    recommendation: text(2000),
    video_url: url,
    start_seconds: nullableNumber,
    end_seconds: nullableNumber,
  })
  .superRefine((v, ctx) => {
    if (v.kind === 'video' && !v.video_url)
      ctx.addIssue({ code: 'custom', path: ['video_url'], message: 'Add an HTTPS video link.' });
    if (v.start_seconds !== null && (!Number.isInteger(v.start_seconds) || v.start_seconds < 0))
      ctx.addIssue({
        code: 'custom',
        path: ['start_seconds'],
        message: 'Use a non-negative whole number of seconds.',
      });
    if (
      v.end_seconds !== null &&
      (!Number.isInteger(v.end_seconds) ||
        v.start_seconds === null ||
        v.end_seconds <= v.start_seconds)
    )
      ctx.addIssue({
        code: 'custom',
        path: ['end_seconds'],
        message: 'End must be after the start.',
      });
  });
export const stationSchema = z
  .strictObject({
    status: z.enum(['active', 'cancelled']),
    tryout_id: z.uuid(),
    session_id: z.uuid(),
    name: required(120),
    location: text(300),
    instructions: text(4000),
    starts_at: timestamp,
    ends_at: timestamp,
    capacity: z.coerce.number().int().min(1).max(1000),
    evaluator_user_id: nullableId,
    group_label: text(160),
  })
  .refine((v) => v.ends_at > v.starts_at, {
    message: 'End must be after start.',
    path: ['ends_at'],
  });
export const scenarioSchema = z.strictObject({
  tryout_id: z.uuid(),
  name: required(160),
  rationale: text(8000),
  status: z.enum(['draft', 'in_review', 'approved', 'archived']),
  target_size: z.coerce.number().int().min(1).max(500),
});
export const scenarioMemberSchema = z.strictObject({
  scenario_id: z.uuid(),
  athlete_id: z.uuid(),
  role: text(120),
  rationale: text(4000),
  response: z.enum(['pending', 'accepted', 'declined', 'waitlisted']),
  response_due: date,
});
export const noticeSchema = z.strictObject({
  tryout_id: z.uuid(),
  title: required(160),
  body: required(8000),
  category: z.enum(['schedule', 'arrival', 'equipment', 'reminder', 'update']),
  status: z.enum(['draft', 'published', 'archived']),
});
export const feeSchema = z
  .strictObject({
    tryout_id: z.uuid(),
    athlete_id: z.uuid(),
    description: required(160),
    currency: z.string().regex(/^[A-Z]{3}$/),
    amount_cents: z.coerce.number().int().min(0).max(10000000),
    paid_cents: z.coerce.number().int().min(0),
    refunded_cents: z.coerce.number().int().min(0),
    waived_cents: z.coerce.number().int().min(0),
    due_on: date,
    reference: text(300),
    note: text(2000),
  })
  .refine(
    (v) =>
      v.refunded_cents <= v.paid_cents &&
      v.waived_cents <= v.amount_cents &&
      v.paid_cents - v.refunded_cents + v.waived_cents <= v.amount_cents,
    { message: 'Amounts exceed the charge or receipt.', path: ['amount_cents'] },
  );
export const correctionSchema = z.strictObject({
  athlete_id: z.uuid(),
  request_text: required(4000),
  response: text(4000),
  status: z.enum(['pending', 'resolved', 'declined']),
});
export const participantLinkSchema = z.strictObject({
  athlete_id: z.uuid(),
  user_id: z.uuid(),
  relationship: z.enum(['athlete', 'guardian']),
  active: boolean,
});
export const talentSchemas = {
  event_notices: noticeSchema,
  event_fees: feeSchema,
  athlete_corrections: correctionSchema,
  participant_links: participantLinkSchema,
  athlete_sport_profiles: profileSchema,
  evaluator_sport_profiles: evaluatorSchema,
  performance_metrics: metricSchema,
  performance_results: resultSchema,
  scouting_records: recordSchema,
  tryout_stations: stationSchema,
  roster_scenarios: scenarioSchema,
  roster_scenario_members: scenarioMemberSchema,
};
export type TalentTable = keyof typeof talentSchemas;
export const tableSchema = z.enum(Object.keys(talentSchemas) as [TalentTable, ...TalentTable[]]);
export const writeSchema = z.strictObject({
  table: tableSchema,
  id: z.uuid(),
  version: z.coerce.number().int().min(0),
  values: z.record(z.string(), z.unknown()),
});
