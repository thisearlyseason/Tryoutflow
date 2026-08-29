export const evaluationSyncStates = [
  'saving_local',
  'saved_device',
  'syncing',
  'synced',
  'needs_attention',
] as const;

export type EvaluationSyncState = (typeof evaluationSyncStates)[number];
