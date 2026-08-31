import { describe, expect, it } from 'vitest';

import { parseReportExportProjection } from '../../../src/modules/reports/infrastructure/supabase-report-gateway';

describe('report projection parser', () => {
  it('accepts the bounded allow-listed evaluation shape', () => {
    expect(
      parseReportExportProjection({
        outcome: 'ok',
        exportType: 'evaluations',
        scopeLabel: 'Badlands',
        rows: [
          {
            athleteNumber: 4,
            preferredName: 'Synthetic',
            session: 'Skills',
            completedCount: 1,
            lockedCount: 0,
            reopenedCount: 0,
            draftCount: 0,
            invalidCount: 0,
            scoredEvaluatorCount: 1,
            overallScore: '80.0000',
          },
        ],
        truncated: false,
      }),
    ).toMatchObject({ outcome: 'ok', exportType: 'evaluations' });
  });

  it.each(['privateNotes', 'evaluatorId', 'guardianEmail', 'birthDate', 'providerToken'])(
    'rejects an unexpected private field: %s',
    (secretField) => {
      expect(() =>
        parseReportExportProjection({
          outcome: 'ok',
          exportType: 'evaluations',
          scopeLabel: 'Badlands',
          rows: [
            {
              athleteNumber: 4,
              preferredName: 'Synthetic',
              session: 'Skills',
              completedCount: 1,
              lockedCount: 0,
              reopenedCount: 0,
              draftCount: 0,
              invalidCount: 0,
              scoredEvaluatorCount: 1,
              overallScore: '80.0000',
              [secretField]: 'must fail closed',
            },
          ],
          truncated: false,
        }),
      ).toThrow(/projection/iu);
    },
  );
});
