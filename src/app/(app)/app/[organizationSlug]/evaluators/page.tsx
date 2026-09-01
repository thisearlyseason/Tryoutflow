import { notFound } from 'next/navigation';

import { ErrorState } from '@/components/feedback/error-state';
import { captureOperationalError } from '@/infrastructure/observability/server-observability';
import { requireCapability } from '@/modules/organizations/application/require-capability';
import { requireCurrentOrganization } from '@/modules/organizations/application/current-organization';

export default async function EvaluatorDirectoryPage({
  params,
}: {
  params: Promise<{ organizationSlug: string }>;
}) {
  const { organizationSlug } = await params;
  const current = await requireCurrentOrganization(organizationSlug);
  if (
    !requireCapability(current.authorization, 'membership:manage', {
      organizationId: current.organization.id,
    }).ok
  )
    notFound();
  const { data, error } = await current.client.rpc('list_organization_evaluators', {
    p_organization_id: current.organization.id,
  });
  if (error) {
    captureOperationalError(error, {
      actorId: current.userId,
      organizationId: current.organization.id,
      operation: 'staffing.load',
    });
    return (
      <ErrorState
        description="The evaluator directory could not be loaded. Refresh before assigning staff."
        title="Evaluator directory temporarily unavailable"
      />
    );
  }

  return (
    <section aria-labelledby="evaluator-directory-heading" className="min-w-0">
      <p className="eyebrow">Organization</p>
      <h2 id="evaluator-directory-heading">Evaluator directory</h2>
      <p className="mt-2 text-[var(--color-text-muted)]">
        Active organization members available for scoped evaluator assignments.
      </p>
      <ul className="mt-6 grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {(data ?? []).map((evaluator) => (
          <li className="card min-w-0 p-4" key={evaluator.evaluator_user_id}>
            <p className="truncate font-semibold">{evaluator.display_name}</p>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">
              {evaluator.active_assignment_count} active assignment
              {evaluator.active_assignment_count === 1 ? '' : 's'}
            </p>
          </li>
        ))}
      </ul>
      {(data ?? []).length === 0 ? (
        <p className="card mt-6 p-5 text-[var(--color-text-muted)]">No active members yet.</p>
      ) : null}
    </section>
  );
}
