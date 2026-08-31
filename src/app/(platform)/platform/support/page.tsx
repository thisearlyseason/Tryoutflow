import { redirect } from 'next/navigation';

import { SystemClock } from '@/lib/clock';
import { parseOrganizationId } from '@/lib/ids';
import { requirePlatformRouteContext } from '@/modules/observability/application/platform-route-context';
import { beginSupportElevation } from '@/modules/organizations/application/begin-support-elevation';
import { SupportElevationList } from '@/modules/observability/ui/platform-administration';

const allowedDurations = new Set([30, 60, 120, 240]);

export default async function PlatformSupportPage({
  searchParams,
}: {
  searchParams: Promise<{ result?: string | string[] }>;
}) {
  const { gateway } = await requirePlatformRouteContext();
  const [organizations, elevations] = await Promise.all([
    gateway.listOrganizations(100),
    gateway.listSupportElevations(),
  ]);
  const rawResult = (await searchParams).result;
  const result = Array.isArray(rawResult) ? null : rawResult;

  async function begin(formData: FormData) {
    'use server';
    const current = await requirePlatformRouteContext();
    let organizationId;
    try {
      organizationId = parseOrganizationId(String(formData.get('organizationId') ?? ''));
    } catch {
      redirect('/platform/support?result=invalid_input');
    }
    const durationMinutes = Number(formData.get('durationMinutes'));
    if (!allowedDurations.has(durationMinutes)) {
      redirect('/platform/support?result=invalid_input');
    }
    const clock = new SystemClock();
    const expiresAt = new Date(clock.now().getTime() + durationMinutes * 60_000);
    const command = await beginSupportElevation(
      {
        organizationId,
        reason: String(formData.get('reason') ?? ''),
        expiresAt,
      },
      current.gateway,
      clock,
    );
    redirect(`/platform/support?result=${command.ok ? 'started' : command.error.code}`);
  }

  return (
    <section aria-labelledby="platform-support-heading">
      <h2 className="text-3xl font-black" id="platform-support-heading">
        Support access
      </h2>
      <p className="mt-2 max-w-3xl text-[var(--color-text-muted)]">
        Elevation is explicit, self-only, time-bound, and auditable. It does not impersonate an
        organization member or silently open tenant content.
      </p>
      {result ? (
        <p
          className="my-4 rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4"
          role="status"
        >
          {result === 'started'
            ? 'Support elevation started and audit evidence recorded.'
            : `Support elevation was not started (${result.replaceAll('_', ' ')}).`}
        </p>
      ) : null}
      <form action={begin} className="my-6 grid max-w-2xl gap-3">
        <label htmlFor="organizationId">Organization</label>
        <select
          className="min-h-11 min-w-0 max-w-full"
          disabled={organizations.length === 0}
          id="organizationId"
          name="organizationId"
          required
        >
          {organizations.map((organization) => (
            <option key={organization.id} value={organization.id}>
              {organization.name} ({organization.slug})
            </option>
          ))}
        </select>
        <label htmlFor="reason">Bounded support reason</label>
        <textarea
          className="min-h-24 min-w-0 max-w-full"
          id="reason"
          maxLength={500}
          minLength={10}
          name="reason"
          required
          rows={4}
        />
        <label htmlFor="durationMinutes">Duration</label>
        <select
          className="min-h-11 min-w-0 max-w-full"
          defaultValue="30"
          id="durationMinutes"
          name="durationMinutes"
          required
        >
          <option value="30">30 minutes</option>
          <option value="60">1 hour</option>
          <option value="120">2 hours</option>
          <option value="240">4 hours</option>
        </select>
        <button className="min-h-11" disabled={organizations.length === 0} type="submit">
          Begin audited support elevation
        </button>
      </form>
      <h2 className="mb-4 mt-8 text-2xl font-black">Recent support evidence</h2>
      <SupportElevationList elevations={elevations} />
    </section>
  );
}
