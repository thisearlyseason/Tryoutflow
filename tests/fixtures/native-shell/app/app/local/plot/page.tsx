import { AthleteRadarChart } from '../../../../../../../src/modules/evaluations/ui/athlete-radar-chart';
const criteria = ['Speed', 'Passing', 'Defense', 'Compete'].map((name, index) => ({
  id: 'synthetic-criterion-' + index,
  name,
}));
export default function Plot() {
  return (
    <main className="p-4">
      <h1>Synthetic scouting overlay</h1>
      <AthleteRadarChart
        criteria={criteria}
        scores={criteria.slice(0, 3).map((c, index) => ({ categoryId: c.id, value: 9 - index }))}
        comparisonScores={criteria.map((c, index) => ({ categoryId: c.id, value: 6 + index }))}
        scale={{ min: 1, max: 10 }}
        athleteName="Synthetic Athlete A"
        comparisonName="Synthetic Athlete B"
      />
    </main>
  );
}
