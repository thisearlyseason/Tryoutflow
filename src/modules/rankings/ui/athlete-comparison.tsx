import { EmptyState } from '../../../components/feedback/empty-state';
import type { AthleteComparison as AthleteComparisonModel } from '../application/compare-athletes';

export function AthleteComparison({ comparison }: { comparison: AthleteComparisonModel }) {
  if (comparison.athletes.length === 0)
    return <EmptyState title="No athletes selected" description="Choose two to four athletes." />;
  const categoryIds = [
    ...new Set(
      comparison.athletes.flatMap((athlete) => athlete.categories.map((row) => row.categoryId)),
    ),
  ];
  const sessionIds = [
    ...new Set(
      comparison.athletes.flatMap((athlete) => athlete.sessions.map((row) => row.sessionId)),
    ),
  ];
  return (
    <div className="max-w-full overflow-x-auto rounded-[var(--radius-surface)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-surface)]">
      <table className="w-full min-w-[40rem] border-collapse text-left">
        <caption className="border-b border-[var(--color-border)] bg-[var(--color-surface-muted)] p-4 text-left text-sm text-[var(--color-text-muted)]">
          Aggregates from completed evaluations. Director operational flags are included; private
          evaluator notes and evaluator identities are excluded. Lower coverage means lower
          confidence.
        </caption>
        <thead className="bg-[var(--color-text)] text-[var(--color-text-inverted)]">
          <tr>
            <th className="p-4" scope="col">
              Evidence
            </th>
            {comparison.athletes.map((athlete) => (
              <th className="p-4" key={athlete.athleteId} scope="col">
                <span className="block text-xs font-black uppercase tracking-[0.12em] opacity-70">
                  Athlete
                </span>
                <span className="text-base">{athlete.displayName}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr className="border-t border-[var(--color-border)]">
            <th className="p-4" scope="row">
              Overall
            </th>
            {comparison.athletes.map((athlete) => (
              <td
                className="p-4 font-[var(--font-bib)] text-3xl font-bold tabular-nums"
                key={athlete.athleteId}
              >
                {athlete.overall ?? 'Unranked'}
              </td>
            ))}
          </tr>
          <tr className="border-t border-[var(--color-border)]">
            <th className="p-4" scope="row">
              Position
            </th>
            {comparison.athletes.map((athlete) => (
              <td className="p-4" key={athlete.athleteId}>
                {athlete.positionName ?? 'Unassigned'}
              </td>
            ))}
          </tr>
          <tr className="border-t border-[var(--color-border)]">
            <th className="p-4" scope="row">
              Director flags
            </th>
            {comparison.athletes.map((athlete) => (
              <td className="p-4" key={athlete.athleteId}>
                {athlete.flags.join(', ') || 'None'}
              </td>
            ))}
          </tr>
          <tr className="border-t border-[var(--color-border)]">
            <th className="p-4" scope="row">
              Coverage
            </th>
            {comparison.athletes.map((athlete) => (
              <td className="p-4" key={athlete.athleteId}>
                {athlete.completedEvaluators} of {athlete.expectedEvaluators} ·{' '}
                {athlete.completionPercent}%
              </td>
            ))}
          </tr>
          <tr className="border-t border-[var(--color-border)]">
            <th className="p-4" scope="row">
              Range
            </th>
            {comparison.athletes.map((athlete) => (
              <td className="p-4" key={athlete.athleteId}>
                {athlete.scoreRange?.join('–') ?? 'Not available'}
              </td>
            ))}
          </tr>
          {categoryIds.map((categoryId) => {
            const name =
              comparison.athletes
                .flatMap((athlete) => athlete.categories)
                .find((row) => row.categoryId === categoryId)?.name ?? 'Category';
            return (
              <tr className="border-t border-[var(--color-border)]" key={categoryId}>
                <th className="p-4" scope="row">
                  {name}
                </th>
                {comparison.athletes.map((athlete) => (
                  <td className="p-4 tabular-nums" key={athlete.athleteId}>
                    {athlete.categories.find((row) => row.categoryId === categoryId)
                      ?.normalizedAverage ?? '—'}
                  </td>
                ))}
              </tr>
            );
          })}
          {sessionIds.map((sessionId) => {
            const sessionName =
              comparison.athletes
                .flatMap((athlete) => athlete.sessions)
                .find((item) => item.sessionId === sessionId)?.sessionName ?? 'Session';
            return (
              <tr className="border-t border-[var(--color-border)]" key={`session-${sessionId}`}>
                <th className="p-4" scope="row">
                  {sessionName} session
                </th>
                {comparison.athletes.map((athlete) => {
                  const evidence = athlete.sessions.find((item) => item.sessionId === sessionId);
                  return (
                    <td className="p-4" key={athlete.athleteId}>
                      {evidence ? (
                        <>
                          {evidence.overall ?? 'Unranked'} · {evidence.completedEvaluators}/
                          {evidence.expectedEvaluators} complete · range{' '}
                          {evidence.scoreRange?.join('–') ?? 'n/a'}
                          {evidence.categories.length > 0 ? (
                            <span className="mt-1 block text-sm text-[var(--color-text-muted)]">
                              {evidence.categories
                                .map((category) => `${category.name} ${category.normalizedAverage}`)
                                .join(' · ')}
                            </span>
                          ) : null}
                        </>
                      ) : (
                        'No authorized evidence'
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
