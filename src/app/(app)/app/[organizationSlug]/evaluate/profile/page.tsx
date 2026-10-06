import Link from 'next/link';
import { requireCurrentOrganization } from '@/modules/organizations/application/current-organization';
import { RecordForm } from '@/modules/talent/ui/record-form';
import { evaluatorDefaults, evaluatorFields, pickValues } from '@/modules/talent/ui/fields';
export default async function EvaluatorProfilePage({
  params,
}: {
  params: Promise<{ organizationSlug: string }>;
}) {
  const { organizationSlug: slug } = await params;
  const c = await requireCurrentOrganization(slug);
  const result = await c.client
    .from('evaluator_sport_profiles')
    .select('*')
    .eq('organization_id', c.organization.id)
    .eq('user_id', c.userId)
    .maybeSingle();
  if (result.error)
    return <p role="alert">Your evaluator profile could not load. Refresh and retry.</p>;
  const p = result.data;
  return (
    <section className="talent-stack">
      <Link
        prefetch={false}
        className="button-secondary"
        href={`/app/${slug}/evaluate/calibration`}
      >
        Evaluator calibration →
      </Link>
      <header>
        <p className="eyebrow">Evaluator workspace</p>
        <h1>Evaluator profile</h1>
        <p>Help organizers match your experience and availability to the right assignment.</p>
      </header>
      <dl className="workspace-card">
        <dt className="eyebrow">Organization</dt>
        <dd>{c.organization.name}</dd>
      </dl>
      <RecordForm
        key={p?.version ?? 0}
        slug={slug}
        table="evaluator_sport_profiles"
        title="Your background and readiness"
        id={p?.id}
        version={p?.version ?? 0}
        defaults={{ ...evaluatorDefaults, user_id: c.userId }}
        initial={p ? pickValues(p, { ...evaluatorDefaults, user_id: c.userId }) : undefined}
        fields={evaluatorFields}
      />
      <Link prefetch={false} href={`/app/${slug}/evaluate`}>
        Return to assigned sessions →
      </Link>
    </section>
  );
}
