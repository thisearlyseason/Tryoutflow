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
            completionState: 'completed',
            overallScore: '80.0',
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
              completionState: 'completed',
              overallScore: '80.0',
              [secretField]: 'must fail closed',
            },
          ],
          truncated: false,
        }),
      ).toThrow(/projection/iu);
    },
  );
});
