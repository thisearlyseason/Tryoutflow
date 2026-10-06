import { EmptyState } from '@/modules/talent/ui/workspace-ui';
import { notFound } from 'next/navigation';
import { loadTalent } from '@/modules/talent/application/workspace';
import { EditRecord } from '@/modules/talent/ui/record-form';
import type { Field } from '@/modules/talent/ui/record-form';
import { pickValues } from '@/modules/talent/ui/fields';
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
  const { data, error } = await w.current.client
    .from('tryout_stations')
    .select('*')
    .eq('organization_id', w.current.organization.id)
    .eq('tryout_id', tryoutId)
    .order('starts_at');
  if (error) throw error;
  const defaults = {
    status: 'active',
    tryout_id: tryoutId,
    session_id: '',
    name: '',
    location: '',
    instructions: '',
    starts_at: '',
    ends_at: '',
    capacity: 12,
    evaluator_user_id: '',
    group_label: '',
  };
  const fields: Field[] = [
    {
      name: 'status',
      label: 'Station status',
      type: 'select',
      required: true,
      options: [
        { value: 'active', label: 'Active' },
        { value: 'cancelled', label: 'Cancelled' },
      ],
    },
    { name: 'name', label: 'Station / rotation', required: true },
    {
      name: 'session_id',
      label: 'Session',
      type: 'select',
      required: true,
      options: w.sessions
        .filter((s) => s.tryout_id === tryoutId)
        .map((s) => ({ value: s.id, label: s.name })),
    },
    { name: 'location', label: 'Surface / court / location' },
    { name: 'starts_at', label: 'Starts (UTC)', type: 'datetime-local', required: true },
    { name: 'ends_at', label: 'Ends (UTC)', type: 'datetime-local', required: true },
    { name: 'capacity', label: 'Athlete capacity', type: 'number', step: '1', required: true },
    {
      name: 'evaluator_user_id',
      label: 'Station lead',
      type: 'select',
      options: w.evaluators.map((p) => ({ value: p.user_id, label: p.display_name })),
    },
    {
      name: 'group_label',
      label: 'Group / rotation identifier',
      help: 'Use the same identifier across stations to prevent overlapping rotations.',
    },
    { name: 'instructions', label: 'Drill instructions and equipment', type: 'textarea' },
  ];
  return (
    <section className="talent-stack">
      <header className="talent-toolbar">
        <div>
          <p className="eyebrow">{event.name}</p>
          <h1>Stations and rotations</h1>
          <p>
            Schedule a group’s path through the event. Overlapping lead or group assignments are
            blocked.
          </p>
        </div>
        <div className="talent-header-actions">
          <PrintReport />
          <EditRecord
            slug={slug}
            table="tryout_stations"
            triggerClassName="button-primary"
            title="Add station block"
            defaults={defaults}
            fields={fields}
          />
        </div>
      </header>
      <div className="talent-stats">
        <div>
          <strong>{data.length}</strong>
          <span>Station blocks</span>
        </div>
        <div>
          <strong>{data.filter((s) => !s.evaluator_user_id).length}</strong>
          <span>Need a station lead</span>
        </div>
        <div>
          <strong>{data.filter((s) => !s.group_label).length}</strong>
          <span>Need a group</span>
        </div>
      </div>
      {!data.length && (
        <EmptyState
          title="Plan your first rotation"
          description="Add a station, assign its lead and schedule a group through the event. Your run sheet will take shape here."
        />
      )}
      {data.map((s) => (
        <article className="talent-card" key={s.id}>
          <p className="eyebrow">
            {s.starts_at.slice(0, 16).replace('T', ' ')}–{s.ends_at.slice(11, 16)} UTC
          </p>
          <h2>
            {s.name} {s.status === 'cancelled' ? '(Cancelled)' : ''}
          </h2>
          <p>
            {s.location || 'Location needed'} · {s.group_label || 'Group needed'} · capacity{' '}
            {s.capacity}
          </p>
          <p>
            Lead:{' '}
            {w.evaluators.find((p) => p.user_id === s.evaluator_user_id)?.display_name ||
              'Unassigned'}
          </p>
          <p className="talent-prose">{s.instructions}</p>
          <EditRecord
            slug={slug}
            table="tryout_stations"
            id={s.id}
            version={s.version}
            title="Edit station"
            defaults={defaults}
            initial={pickValues(s, defaults)}
            fields={fields}
          />
        </article>
      ))}
    </section>
  );
}
