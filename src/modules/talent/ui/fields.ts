import type { Field } from './record-form';
export const options = (values: readonly string[]) =>
  values.map((value) => ({
    value,
    label: value.replaceAll('_', ' ').replace(/^./, (c) => c.toUpperCase()),
  }));
export const profileDefaults = {
  preferred_name: '',
  sport: '',
  primary_position: '',
  secondary_positions: '',
  current_team: '',
  competitive_level: '',
  dominant_side: '',
  hometown: '',
  biography: '',
  tags: '',
  stage: 'identified',
};
export const profileFields: Field[] = [
  { name: 'preferred_name', label: 'Preferred name' },
  { name: 'sport', label: 'Sport' },
  { name: 'primary_position', label: 'Primary position' },
  { name: 'secondary_positions', label: 'Other positions' },
  { name: 'current_team', label: 'Current team / club' },
  { name: 'competitive_level', label: 'Competitive level' },
  { name: 'dominant_side', label: 'Dominant hand / foot / shooting side' },
  { name: 'hometown', label: 'Hometown' },
  {
    name: 'tags',
    label: 'Watchlist tags',
    help: 'Separate tags with commas, for example: U18, left defence, regional.',
  },
  {
    name: 'stage',
    label: 'Recruitment stage',
    type: 'select',
    required: true,
    options: options([
      'identified',
      'observe',
      'follow_up',
      'invited',
      'evaluating',
      'selected',
      'monitor',
      'closed',
    ]),
  },
  { name: 'biography', label: 'Sporting background', type: 'textarea' },
];
export const evaluatorDefaults = {
  affiliation: '',
  device_check_complete: false,
  assignments_acknowledged: false,
  display_name: '',
  sport: '',
  specialties: '',
  qualifications: '',
  experience: '',
  availability: '',
  conflict_disclosure: '',
  briefing_complete: false,
};
export const evaluatorFields: Field[] = [
  { name: 'affiliation', label: 'Team / organization affiliation' },
  { name: 'display_name', label: 'Display name', required: true },
  { name: 'sport', label: 'Sport' },
  { name: 'specialties', label: 'Position / skill specialties' },
  { name: 'qualifications', label: 'Qualifications and certifications', type: 'textarea' },
  { name: 'experience', label: 'Coaching and scouting experience', type: 'textarea' },
  { name: 'availability', label: 'Availability', type: 'textarea' },
  {
    name: 'conflict_disclosure',
    label: 'Conflicts of interest / recusal',
    type: 'textarea',
    help: 'Visible to you and organization managers.',
  },
  {
    name: 'device_check_complete',
    section: 'Preparation declarations',
    label: 'I tested scoring and synchronization on my evaluation device',
    type: 'checkbox',
    help: 'Self-reported preparation; server receipt exceptions remain visible in coverage.',
  },
  {
    name: 'assignments_acknowledged',
    label: 'I reviewed my current assignments and availability',
    type: 'checkbox',
    help: 'Reconfirm with the director when assignments change.',
  },
  {
    name: 'briefing_complete',
    label: 'I have completed the scoring rubric briefing',
    type: 'checkbox',
  },
];
export const metricDefaults = {
  name: '',
  sport: '',
  unit: '',
  value_kind: 'decimal',
  direction: 'higher',
  aggregation: 'best',
  protocol: '',
  minimum: '',
  maximum: '',
};
export const metricFields: Field[] = [
  { name: 'name', label: 'Metric name', required: true },
  { name: 'sport', label: 'Sport', required: true },
  { name: 'unit', label: 'Unit', required: true, help: 'For example s, cm, km/h, %, repetitions.' },
  {
    name: 'value_kind',
    label: 'Measurement type',
    type: 'select',
    required: true,
    options: options(['decimal', 'duration', 'distance', 'speed', 'count', 'ratio']),
  },
  {
    name: 'direction',
    label: 'Better performance means',
    type: 'select',
    required: true,
    options: [
      { value: 'higher', label: 'Higher value' },
      { value: 'lower', label: 'Lower value' },
      { value: 'neutral', label: 'Descriptive only — no ranking' },
    ],
  },
  {
    name: 'aggregation',
    label: 'Combine repeated trials using',
    type: 'select',
    required: true,
    options: options(['best', 'mean', 'latest']),
  },
  { name: 'minimum', label: 'Lowest valid value', type: 'number' },
  { name: 'maximum', label: 'Highest valid value', type: 'number' },
  {
    name: 'protocol',
    label: 'Measurement protocol',
    type: 'textarea',
    required: true,
    help: 'Describe equipment, distance, conditions and timing. Create a new metric when the protocol changes.',
  },
];
export const resultDefaults = {
  athlete_id: '',
  metric_id: '',
  session_id: '',
  value: '',
  numerator: '',
  denominator: '',
  status: 'valid',
  trial: 1,
  measured_at: '',
  source: '',
  verified: false,
  note: '',
};
export const recordDefaults = {
  observation_type: 'live',
  event_context: '',
  criterion: '',
  review_feedback: '',
  athlete_id: '',
  kind: 'report',
  title: '',
  body: '',
  status: 'draft',
  visibility: 'staff',
  observed_at: '',
  due_on: '',
  assigned_user_id: '',
  source: '',
  strengths: '',
  development_areas: '',
  recommendation: '',
  video_url: '',
  start_seconds: '',
  end_seconds: '',
};
export function recordFields(
  kind: string,
  athletes: { value: string; label: string }[],
  people: { value: string; label: string }[],
  fixedAthlete = false,
): Field[] {
  return [
    ...(!fixedAthlete
      ? [
          {
            name: 'athlete_id',
            label: 'Athlete',
            type: 'select' as const,
            required: true,
            options: athletes,
          },
        ]
      : []),
    { name: 'title', label: kind === 'watchlist' ? 'Watchlist name' : 'Title', required: true },
    {
      name: 'observation_type',
      section: 'Observation context',
      label: 'Observation method',
      required: true,
      type: 'select',
      options: options(['live', 'video', 'training', 'other']),
    },
    {
      name: 'event_context',
      label: 'Event, opponent and location',
      help: 'Include the game/session and competitive context.',
    },
    { name: 'criterion', label: 'Skill / criterion supported by this evidence' },
    ...(['task', 'goal'].includes(kind)
      ? [
          {
            name: 'due_on',
            section: 'Ownership & timing',
            label: 'Due date',
            type: 'date' as const,
          },
          {
            name: 'assigned_user_id',
            label: 'Assigned to',
            type: 'select' as const,
            options: people,
          },
        ]
      : []),
    ...(['report', 'video'].includes(kind)
      ? [
          { name: 'observed_at', label: 'Observed at (UTC)', type: 'datetime-local' as const },
          {
            name: 'source',
            label: 'Event / source',
            help: 'Name the event, opponent, recording or observation context.',
          },
        ]
      : []),
    ...(kind === 'report'
      ? [
          {
            name: 'strengths',
            section: 'Assessment',
            label: 'Strengths and supporting evidence',
            type: 'textarea' as const,
          },
          { name: 'development_areas', label: 'Development areas', type: 'textarea' as const },
          {
            name: 'recommendation',
            label: 'Role fit and recommended next step',
            type: 'textarea' as const,
          },
        ]
      : []),
    ...(kind === 'video'
      ? [
          {
            name: 'video_url',
            section: 'Video evidence',
            label: 'HTTPS video link',
            type: 'url' as const,
            required: true,
          },
          {
            name: 'start_seconds',
            label: 'Clip start (seconds)',
            type: 'number' as const,
            step: '1',
          },
          { name: 'end_seconds', label: 'Clip end (seconds)', type: 'number' as const, step: '1' },
        ]
      : []),
    {
      name: 'body',
      label: kind === 'goal' ? 'Goal, success measure and progress' : 'Notes',
      type: 'textarea',
    },
    {
      name: 'status',
      section: 'Review & sharing',
      label: 'Status',
      type: 'select',
      required: true,
      options: options(['draft', 'active', 'in_review', 'approved', 'complete', 'archived']),
    },
    {
      name: 'visibility',
      label: 'Audience',
      type: 'select',
      required: true,
      options: [
        { value: 'private', label: 'Only me' },
        { value: 'staff', label: 'Scouting staff' },
        { value: 'athlete', label: 'Approved athlete feedback' },
      ],
    },
  ];
}
export function pickValues(row: Record<string, unknown>, defaults: Record<string, unknown>) {
  return Object.fromEntries(Object.keys(defaults).map((key) => [key, row[key] ?? defaults[key]]));
}
