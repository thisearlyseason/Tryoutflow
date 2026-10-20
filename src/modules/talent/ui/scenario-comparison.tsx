import Link from 'next/link';
import type { Row } from '../application/workspace';
export function ScenarioComparison({
  scenarios,
  members,
  athletes,
  slug,
}: {
  scenarios: Row<'roster_scenarios'>[];
  members: Row<'roster_scenario_members'>[];
  athletes: { id: string; given_name: string; family_name: string }[];
  slug: string;
}) {
  if (scenarios.length < 2) return null;
  const ids = new Set(scenarios.map((s) => s.id));
  const selected = members.filter((m) => ids.has(m.scenario_id));
  const athleteIds = [...new Set(selected.map((m) => m.athlete_id))];
  return (
    <section className="talent-card">
      <h2>Compare alternatives</h2>
      <p>
        Review shared selections, different role choices and response states. Archived alternatives
        retain their original rationale.
      </p>
      <div className="talent-table">
        <table>
          <caption className="sr-only">Roster scenario comparison</caption>
          <thead>
            <tr>
              <th>Athlete</th>
              {scenarios.map((s) => (
                <th key={s.id}>
                  {s.name}
                  <br />
                  <small>
                    {s.status} · target {s.target_size}
                  </small>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {athleteIds.map((id) => {
              const a = athletes.find((a) => a.id === id);
              return (
                <tr key={id}>
                  <th>
                    <Link href={`/app/${slug}/athletes/${id}`}>
                      {a?.given_name} {a?.family_name}
                    </Link>
                  </th>
                  {scenarios.map((s) => {
                    const m = selected.find((m) => m.athlete_id === id && m.scenario_id === s.id);
                    return (
                      <td key={s.id}>
                        {m ? (
                          <>
                            <strong>{m.role || 'Role needed'}</strong>
                            <br />
                            {m.response}
                            <p>{m.rationale}</p>
                          </>
                        ) : (
                          'Not selected'
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
      <h3>Role balance</h3>
      <div className="talent-grid">
        {scenarios.map((s) => {
          const counts = new Map<string, number>();
          selected
            .filter(
              (m) => m.scenario_id === s.id && !['declined', 'waitlisted'].includes(m.response),
            )
            .forEach((m) =>
              counts.set(m.role || 'Role needed', (counts.get(m.role || 'Role needed') ?? 0) + 1),
            );
          return (
            <div key={s.id}>
              <strong>{s.name}</strong>
              <ul>
                {[...counts].map(([role, count]) => (
                  <li key={role}>
                    {role}: {count}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </section>
  );
}
