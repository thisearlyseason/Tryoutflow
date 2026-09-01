import Link from 'next/link';

import { ErrorState } from '@/components/feedback/error-state';
import { captureOperationalError } from '@/infrastructure/observability/server-observability';
import { requireCurrentOrganization } from '@/modules/organizations/application/current-organization';

export default async function EvaluatorProfilePage({
  params,
}: {
  params: Promise<{ organizationSlug: string }>;
}) {
  const { organizationSlug } = await params;
  const current = await requireCurrentOrganization(organizationSlug);
  const profile = await current.client
    .from('profiles')
    .select('display_name,updated_at')
    .eq('id', current.userId)
    .maybeSingle();

  if (profile.error) {
    captureOperationalError(profile.error, {
      actorId: current.userId,
      organizationId: current.organization.id,
      operation: 'profile.load',
    });
    return (
      <ErrorState
        action={
          <Link
            className="button-secondary inline-flex min-h-11 items-center"
            href={`/app/${organizationSlug}/evaluate/profile`}
            prefetch={false}
          >
            Retry profile
          </Link>
        }
        description="No profile data was changed. Retry or return to your assigned sessions."
        title="Evaluator profile temporarily unavailable"
      />
    );
  }

  return (
    <section aria-labelledby="evaluator-profile-heading" className="grid min-w-0 gap-5">
      <header>
        <p className="eyebrow">Evaluator workspace</p>
        <h2 id="evaluator-profile-heading">Evaluator profile</h2>
        <p className="mt-2 text-[var(--color-text-muted)]">
          This global display preference is visible only through your signed-in account boundary.
        </p>
      </header>
      <dl className="card grid gap-3 p-5 sm:grid-cols-[minmax(8rem,auto)_1fr]">
        <dt className="font-semibold">Display name</dt>
        <dd>{profile.data?.display_name ?? 'No display name configured'}</dd>
        <dt className="font-semibold">Current organization</dt>
        <dd>{current.organization.name}</dd>
      </dl>
      <Link
        className="button-secondary inline-flex min-h-11 w-fit items-center"
        href={`/app/${organizationSlug}/evaluate`}
        prefetch={false}
      >
        Return to assigned sessions
      </Link>
    </section>
  );
}
