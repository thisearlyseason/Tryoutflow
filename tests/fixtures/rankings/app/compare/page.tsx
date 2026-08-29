import { AthleteComparison } from '../../../../../src/modules/rankings/ui/athlete-comparison';
import { fixtureRows } from '../page';

export default function Compare() {
  return (
    <>
      <h1 className="mb-4">Athlete comparison</h1>
      <AthleteComparison
        comparison={{
          generatedAt: fixtureRows.generatedAt,
          athletes: fixtureRows.rows.map((row) => ({
            athleteId: row.athleteId,
            displayName: row.displayName,
            tryoutNumber: row.tryoutNumber,
            divisionName: row.divisionName,
            positionName: row.positionName,
            overall: row.overall,
            completedEvaluators: row.completedEvaluators,
            expectedEvaluators: row.expectedEvaluators,
            completionPercent: row.completionPercent,
            scoreRange: row.scoreRange,
            categories: row.categories,
            flags: row.flags,
          })),
        }}
      />
    </>
  );
}
