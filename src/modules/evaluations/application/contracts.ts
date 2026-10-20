export type EvaluationPlacement = {
  organizationId: string;
  tryoutId: string;
  divisionId: string;
  sessionId: string;
  groupId: string | null;
};

export type SaveOutcome =
  | { outcome: 'saved'; evaluationId: string; version: number }
  | {
      outcome:
        | 'forbidden'
        | 'invalid_context'
        | 'invalid_score'
        | 'invalid_note_tag'
        | 'locked'
        | 'conflict'
        | 'unexpected';
    };

type LifecycleFailureOutcome =
  | 'forbidden'
  | 'required_scores_missing'
  | 'locked'
  | 'invalid_state'
  | 'invalid_reason'
  | 'conflict'
  | 'unexpected';

export type LifecycleOutcome<TSuccess extends string> =
  | { outcome: TSuccess; version: number }
  | {
      outcome: Exclude<LifecycleFailureOutcome, TSuccess>;
    };

export type ConfigureTagOutcome =
  | { outcome: 'saved'; noteTagId: string }
  | { outcome: 'forbidden' | 'invalid_tag' | 'conflict' | 'unexpected' };

export type DirectorFlagOutcome =
  | { outcome: 'saved' | 'revoked'; athleteFlagId: string }
  | { outcome: 'forbidden' | 'invalid_flag' | 'conflict' | 'unexpected' };

export type SaveEvaluationGateway = {
  save(
    input: EvaluationPlacement & {
      registrationId: string;
      evaluatorUserId: string;
      rubricVersionId: string;
      expectedVersion: number;
      scores: { categoryId: string; value: number }[];
      note?: string;
      noteTagIds?: string[];
      flags?: string[];
    },
  ): Promise<SaveOutcome>;
};

export type CompleteEvaluationGateway = {
  complete(
    input: EvaluationPlacement & { evaluationId: string; expectedVersion: number },
  ): Promise<LifecycleOutcome<'completed'>>;
};

export type ReopenEvaluationGateway = {
  reopen(
    input: EvaluationPlacement & { evaluationId: string; expectedVersion: number; reason: string },
  ): Promise<LifecycleOutcome<'reopened'>>;
};

export type LockEvaluationGateway = {
  lock(
    input: EvaluationPlacement & { evaluationId: string; expectedVersion: number },
  ): Promise<LifecycleOutcome<'locked'>>;
};

export type ConfigureEvaluationNoteTagGateway = {
  configure(input: {
    organizationId: string;
    noteTagId: string | null;
    label: string;
    active: boolean;
  }): Promise<ConfigureTagOutcome>;
};

export type DirectorFlagGateway = {
  manage(
    input: EvaluationPlacement & {
      registrationId: string;
      flagId: string | null;
      action: 'upsert' | 'revoke';
      flagType: 'needs_another_look' | 'injury_concern' | 'eligibility_review';
    },
  ): Promise<DirectorFlagOutcome>;
};

export type EvaluationGateway = SaveEvaluationGateway &
  CompleteEvaluationGateway &
  ReopenEvaluationGateway &
  LockEvaluationGateway &
  ConfigureEvaluationNoteTagGateway &
  DirectorFlagGateway;
