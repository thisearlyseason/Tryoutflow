import { NoticeDelivery } from '@/modules/talent/ui/notice-delivery';
import { notFound } from 'next/navigation';
import { loadTalent } from '@/modules/talent/application/workspace';
import { EditRecord } from '@/modules/talent/ui/record-form';
import type { Field } from '@/modules/talent/ui/record-form';
import { options, pickValues } from '@/modules/talent/ui/fields';
export default async function Page({
  params,
}: {
  params: Promise<{ organizationSlug: string; tryoutId: string }>;
}) {
  const { organizationSlug: slug, tryoutId } = await params;
  const w = await loadTalent(slug);
  const c = w.current;
  if (!['owner', 'administrator'].includes(c.authorization.organizationRole)) notFound();
  const event = w.tryouts.find((t) => t.id === tryoutId);
  if (!event) notFound();
  const [notices, fees] = await Promise.all([
    c.client
      .from('event_notices')
      .select('*')
      .eq('organization_id', c.organization.id)
      .eq('tryout_id', tryoutId)
      .order('created_at', { ascending: false }),
    c.client
      .from('event_fees')
      .select('*')
      .eq('organization_id', c.organization.id)
      .eq('tryout_id', tryoutId),
  ]);
  if (notices.error || fees.error) throw new Error('Event operations could not load.');
  const nd = { tryout_id: tryoutId, title: '', body: '', category: 'update', status: 'draft' };
  const nf: Field[] = [
    { name: 'title', label: 'Notice title', required: true },
    {
      name: 'category',
      label: 'Notice type',
      type: 'select',
      required: true,
      options: options(['schedule', 'arrival', 'equipment', 'reminder', 'update']),
    },
    {
      name: 'status',
      label: 'Publication',
      type: 'select',
      required: true,
      options: options(['draft', 'published', 'archived']),
    },
    {
      name: 'body',
      label: 'Instructions for athletes and families',
      type: 'textarea',
      required: true,
    },
  ];
  const fd = {
    tryout_id: tryoutId,
    athlete_id: '',
    description: 'Tryout registration fee',
    currency: 'CAD',
    amount_cents: 0,
    paid_cents: 0,
    refunded_cents: 0,
    waived_cents: 0,
    due_on: '',
    reference: '',
    note: '',
  };
  const ff: Field[] = [
    {
      name: 'athlete_id',
      label: 'Athlete',
      type: 'select',
      required: true,
      options: w.athletes.map((a) => ({ value: a.id, label: `${a.given_name} ${a.family_name}` })),
    },
    { name: 'description', label: 'Charge description', required: true },
    { name: 'currency', label: 'Currency (CAD, USD, etc.)', required: true },
    ...['amount', 'paid', 'refunded', 'waived'].map((k) => ({
      name: `${k}_cents`,
      label: `${k[0]!.toUpperCase() + k.slice(1)} (cents)`,
      type: 'number' as const,
      required: true,
      step: '1',
      help: 'For example 7500 means $75.00.',
    })),
    { name: 'due_on', label: 'Due date', type: 'date' },
    {
      name: 'reference',
      label: 'Receipt / waiver approval reference',
      help: 'Required when recording any payment, refund or waiver.',
    },
    { name: 'note', label: 'Internal ledger note', type: 'textarea' },
  ];
  return (
    <section className="talent-stack">
      <header>
        <p className="eyebrow">{event.name}</p>
        <h1>Event notices and fees</h1>
        <p>
          Publish arrival and schedule information before roster decisions. Maintain event charges
          separately from your TryoutFlow subscription.
        </p>
      </header>
      <h2>Participant notices</h2>
      <p>
        Published notices appear in linked participants’ portals. Publishing here does not send an
        email.
      </p>
      {notices.data.map((n) => (
        <article className="talent-card" key={n.id}>
          <h3>{n.title}</h3>
          <p>
            {n.status} · {n.category}
          </p>
          <p>{n.body}</p>
          <EditRecord
            slug={slug}
            table="event_notices"
            id={n.id}
            version={n.version}
            defaults={nd}
            initial={pickValues(n, nd)}
            fields={nf}
            title="Edit / publish notice"
          />
          {n.status === 'published' && <NoticeDelivery slug={slug} noticeId={n.id} />}
        </article>
      ))}
      <EditRecord
        slug={slug}
        table="event_notices"
        defaults={nd}
        fields={nf}
        title="Create participant notice"
      />
      <h2>Fee ledger</h2>
      <p>
        Record confirmed offline transactions with their receipt references. This ledger does not
        charge a card or initiate a refund.
      </p>
      {fees.data.map((f) => (
        <article className="talent-card" key={f.id}>
          <h3>
            {w.athletes.find((a) => a.id === f.athlete_id)?.given_name}{' '}
            {w.athletes.find((a) => a.id === f.athlete_id)?.family_name} · {f.description}
          </h3>
          <p>
            {f.currency} {(f.amount_cents / 100).toFixed(2)} charged · balance{' '}
            {((f.amount_cents - f.paid_cents + f.refunded_cents - f.waived_cents) / 100).toFixed(2)}
          </p>
          <p>Receipt: {f.reference || 'None recorded'}</p>
          <EditRecord
            slug={slug}
            table="event_fees"
            id={f.id}
            version={f.version}
            defaults={fd}
            initial={pickValues(f, fd)}
            fields={ff.filter((field) => field.name !== 'athlete_id')}
            title="Record payment / refund / waiver"
          />
        </article>
      ))}
      <EditRecord
        slug={slug}
        table="event_fees"
        defaults={fd}
        fields={ff}
        title="Add athlete fee"
      />
    </section>
  );
}
