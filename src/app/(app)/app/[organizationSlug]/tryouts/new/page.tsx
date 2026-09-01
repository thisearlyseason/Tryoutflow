import Link from 'next/link';
import { redirect } from 'next/navigation';

import { ErrorState } from '@/components/feedback/error-state';
import { trackSupabaseWorkflowSafely } from '@/infrastructure/analytics/supabase-analytics-provider';
import { captureOperationalError } from '@/infrastructure/observability/server-observability';
import { createCorrelationId } from '@/modules/observability/domain/correlation-id';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { createTryout } from '@/modules/tryouts/application/create-tryout';
import { requireCurrentOrganization } from '@/modules/organizations/application/current-organization';

export default async function NewTryoutPage({
  params,
}: {
  params: Promise<{ organizationSlug: string }>;
}) {
  const { organizationSlug } = await params;
  const current = await requireCurrentOrganization(organizationSlug);
  const seasonsResult = await current.client
    .from('seasons')
    .select('id,name')
    .eq('organization_id', current.organization.id)
    .order('name');
  if (seasonsResult.error) {
    captureOperationalError(seasonsResult.error, {
      actorId: current.userId,
      organizationId: current.organization.id,
      operation: 'tryouts.load',
    });
    return (
      <ErrorState
        action={
          <Link
            className="button-secondary inline-flex min-h-11 items-center"
            href={`/app/${organizationSlug}/tryouts/new`}
            prefetch={false}
          >
            Retry cycles
          </Link>
        }
        description="Available cycles could not be loaded. No draft was created."
        title="Tryout setup temporarily unavailable"
      />
    );
  }
  const seasons = seasonsResult.data ?? [];
  async function create(formData: FormData) {
    'use server';
    const route = await requireCurrentOrganization(organizationSlug);
    const result = await createTryout(
      {
        organizationId: route.organization.id,
        seasonId: formData.get('seasonId') || undefined,
        newSeasonName: formData.get('newSeasonName') || undefined,
        name: formData.get('name'),
        sport: formData.get('sport'),
        timezone: formData.get('timezone'),
        registrationStartsAt: formData.get('registrationStartsAt') || undefined,
        registrationEndsAt: formData.get('registrationEndsAt') || undefined,
      },
      { authorization: route.authorization },
    );
    if (!result.ok) redirect(`/app/${organizationSlug}/tryouts/new?error=${result.error.code}`);
    await trackSupabaseWorkflowSafely(route.client, {
      name: 'workflow.completed',
      workflow: 'tryout_setup',
      organizationId: route.organization.id,
      correlationId: createCorrelationId(),
    });
    redirect(`/app/${organizationSlug}/tryouts/${result.value.id}/setup/basics`);
  }
  return (
    <section aria-labelledby="new-tryout-heading" className="max-w-xl">
      <p className="eyebrow">Tryout setup</p>
      <h2 id="new-tryout-heading">Create a draft</h2>
      <form action={create} className="mt-6 space-y-4">
        <label className="block" htmlFor="name">
          <span className="font-bold">Tryout name</span>
          <Input id="name" name="name" required />
        </label>
        <label className="block" htmlFor="sport">
          <span className="font-bold">Sport</span>
          <Input
            defaultValue={current.organization.sportDefaults[0] ?? ''}
            id="sport"
            name="sport"
            required
          />
        </label>
        <fieldset className="space-y-3">
          <legend className="font-bold">Cycle or season</legend>
          <label className="block" htmlFor="seasonId">
            <span>Use an existing cycle</span>
            <select className="min-h-11 w-full rounded border px-3" id="seasonId" name="seasonId">
              <option value="">Create a new cycle</option>
              {seasons.map((season) => (
                <option key={season.id} value={season.id}>
                  {season.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block" htmlFor="newSeasonName">
            <span>New cycle name</span>
            <Input id="newSeasonName" maxLength={120} name="newSeasonName" />
          </label>
          <p className="text-sm text-[var(--color-text-muted)]">
            Choose an existing cycle, or leave it on “Create a new cycle” and enter a new name.
          </p>
        </fieldset>
        <label className="block" htmlFor="timezone">
          <span className="font-bold">Timezone</span>
          <Input
            defaultValue={current.organization.timezone}
            id="timezone"
            name="timezone"
            required
          />
        </label>
        <label className="block" htmlFor="registrationStartsAt">
          <span className="font-bold">Registration opens</span>
          <Input
            id="registrationStartsAt"
            name="registrationStartsAt"
            type="datetime-local"
            required
          />
        </label>
        <label className="block" htmlFor="registrationEndsAt">
          <span className="font-bold">Registration closes</span>
          <Input id="registrationEndsAt" name="registrationEndsAt" type="datetime-local" required />
        </label>
        <Button type="submit">Create draft</Button>
      </form>
    </section>
  );
}
