import { EmptyState } from '@/modules/talent/ui/workspace-ui';
import Link from 'next/link';
import { ScenarioComparison } from '@/modules/talent/ui/scenario-comparison';
import { notFound } from 'next/navigation';
import { loadTalent } from '@/modules/talent/application/workspace';
import { EditRecord } from '@/modules/talent/ui/record-form';
import type { Field } from '@/modules/talent/ui/record-form';
import { options, pickValues } from '@/modules/talent/ui/fields';
import { PrintReport } from '@/modules/talent/ui/report-actions';
export default async function Page({
  params,
}: {
  params: Promise<{ organizationSlug: string; tryoutId: string }>;
}) {
  const { organizationSlug: slug, tryoutId } = await params;
  const w = await loadTalent(slug);
  if (!['owner', 'administrator'].includes(w.current.authorization.organizationRole)) notFound();
  const event = w.tryouts.find((t) => t.id === tryoutId);
  if (!event) notFound();
  const [scenarios, members] = await Promise.all([
    w.current.client
      .from('roster_scenarios')
      .select('*')
      .eq('organization_id', w.current.organization.id)
      .eq('tryout_id', tryoutId)
      .order('created_at'),
    w.current.client
      .from('roster_scenario_members')
      .select('*')
      .eq('organization_id', w.current.organization.id),
  ]);
  if (scenarios.error || members.error) throw new Error('Could not load roster scenarios.');
  const defaults = {
    tryout_id: tryoutId,
    name: '',
    rationale: '',
    status: 'draft',
    target_size: 20,
  };
  const fields: Field[] = [
    { name: 'name', label: 'Scenario name', required: true },
    { name: 'target_size', label: 'Target roster size', type: 'number', required: true, step: '1' },
    {
      name: 'status',
      label: 'Review status',
      type: 'select',
      required: true,
      options: options(['draft', 'in_review', 'approved', 'archived']),
    },
    {
      name: 'rationale',
      label: 'Selection strategy and approval rationale',
      type: 'textarea',
      help: 'Approval requires rationale, at least one athlete, and a selection within target size.',
    },
  ];
  return (
    <section className="talent-stack">
      <header className="talent-toolbar">
        <div>
          <p className="eyebrow">{event.name}</p>
          <h1>Roster scenarios</h1>
          <p>
            Compare alternatives, document role fit, approve a selection and record responses.
            Publish final rosters in the roster workspace.
          </p>
        </div>
        <div className="talent-header-actions">
          <PrintReport />
          <EditRecord
            slug={slug}
            table="roster_scenarios"
            defaults={defaults}
            fields={fields}
            triggerClassName="button-primary"
            title="Create alternative roster"
          />
        </div>
      </header>
      <Link href={`/app/${slug}/tryouts/${tryoutId}/rosters`}>Open final roster workspace →</Link>
      {!scenarios.data.length && (
        <EmptyState
          title="Build a selection scenario"
          description="Create a draft roster to compare athletes, document role fit and review a balanced selection with your staff."
        />
      )}
      <ScenarioComparison
        scenarios={scenarios.data}
        members={members.data}
        athletes={w.athletes}
        slug={slug}
      />
      {scenarios.data.map((s) => {
        const selected = members.data.filter((m) => m.scenario_id === s.id);
        const md = {
          scenario_id: s.id,
          athlete_id: '',
          role: '',
          rationale: '',
          response: 'pending',
          response_due: '',
        };
        const mf: Field[] = [
          {
            name: 'athlete_id',
            label: 'Athlete',
            type: 'select',
            required: true,
            options: w.athletes.map((a) => ({
              value: a.id,
              label: `${a.given_name} ${a.family_name}`,
            })),
          },
          { name: 'role', label: 'Projected role / position' },
          { name: 'rationale', label: 'Selection rationale', type: 'textarea' },
          {
            name: 'response',
            label: 'Offer response',
            type: 'select',
            required: true,
            options: options(['pending', 'accepted', 'declined', 'waitlisted']),
          },
          { name: 'response_due', label: 'Response due', type: 'date' },
        ];
        return (
          <article className="talent-card talent-stack" key={s.id}>
            <header className="talent-toolbar">
              <h2>{s.name}</h2>
              <span className="talent-tag">
                {s.status} · {selected.filter((m) => m.response !== 'declined').length}/
                {s.target_size} selected
              </span>
            </header>
            <p className="talent-prose">{s.rationale}</p>
            <p>
              {selected.filter((m) => m.response === 'accepted').length} accepted ·{' '}
              {selected.filter((m) => m.response === 'pending').length} awaiting response ·{' '}
              {selected.filter((m) => m.response === 'declined').length} declined
            </p>
            {selected.map((m) => (
              <div className="talent-card" key={m.id}>
                <h3>
                  <Link href={`/app/${slug}/athletes/${m.athlete_id}`}>
                    {w.athletes.find((a) => a.id === m.athlete_id)?.given_name}{' '}
                    {w.athletes.find((a) => a.id === m.athlete_id)?.family_name}
                  </Link>
                </h3>
                <p>
                  {m.role || 'Role needed'} · {m.response}{' '}
                  {m.response_due ? `· due ${m.response_due}` : ''}
                </p>
                <p>{m.rationale}</p>
                <EditRecord
                  slug={slug}
                  table="roster_scenario_members"
                  id={m.id}
                  version={m.version}
                  defaults={md}
                  initial={pickValues(m, md)}
                  fields={mf.filter((f) => f.name !== 'athlete_id')}
                  title="Update selection / response"
                />
              </div>
            ))}
            {!['approved', 'archived'].includes(s.status) && (
              <EditRecord
                slug={slug}
                table="roster_scenario_members"
                defaults={md}
                fields={mf}
                title="Add athlete to scenario"
              />
            )}
            <EditRecord
              slug={slug}
              table="roster_scenarios"
              id={s.id}
              version={s.version}
              defaults={defaults}
              initial={pickValues(s, defaults)}
              fields={fields}
              title="Review / approve scenario"
            />
          </article>
        );
      })}
    </section>
  );
}
