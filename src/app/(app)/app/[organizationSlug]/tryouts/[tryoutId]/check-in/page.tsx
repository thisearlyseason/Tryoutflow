import { createHash, randomUUID } from 'node:crypto';

import { notFound } from 'next/navigation';

import { CheckinWorkspace } from '@/modules/checkin/ui/checkin-workspace';
import { requireCapability } from '@/modules/organizations/application/require-capability';
import { requireCurrentOrganization } from '@/modules/organizations/application/current-organization';

export default async function CheckinPage({
  params,
}: {
  params: Promise<{ organizationSlug: string; tryoutId: string }>;
}) {
  const { organizationSlug, tryoutId } = await params;
  const current = await requireCurrentOrganization(organizationSlug);
  const { data: tryout } = await current.client
    .from('tryouts')
    .select('id,name')
    .eq('organization_id', current.organization.id)
    .eq('id', tryoutId)
    .maybeSingle();
  if (!tryout) notFound();
  const { data: sessions } = await current.client
    .from('tryout_sessions')
    .select('id,name,division_id,session_groups(id,name)')
    .eq('organization_id', current.organization.id)
    .eq('tryout_id', tryoutId)
    .order('starts_at');
  const placements =
    sessions?.flatMap((session) => {
      const groups = session.session_groups;
      if (groups.length === 0) {
        return [{ sessionId: session.id, sessionName: session.name }];
      }
      return groups.map((group) => ({
        sessionId: session.id,
        sessionName: session.name,
        groupId: group.id,
        groupName: group.name,
      }));
    }) ?? [];
  if (
    placements.length === 0 ||
    !sessions?.some(
      (session) =>
        requireCapability(current.authorization, 'checkin:read', {
          organizationId: current.organization.id,
          tryoutId,
          divisionId: session.division_id,
          sessionId: session.id,
        }).ok,
    )
  )
    notFound();

  async function search(query: string) {
    'use server';
    const scoped = await requireCurrentOrganization(organizationSlug);
    const rateKey = createHash('sha256')
      .update(`${scoped.userId}:${scoped.organization.id}:${tryoutId}:checkin-search`)
      .digest('hex');
    const { data, error } = await scoped.client.rpc('search_checkin_registrations', {
      p_organization_id: scoped.organization.id,
      p_tryout_id: tryoutId,
      p_query: query,
      p_limit: 25,
      p_rate_key_hash: rateKey,
    });
    if (error) throw new Error('Check-in search failed');
    return data.map((row) => ({
      registrationId: row.registration_id,
      athleteName: row.athlete_name,
      guardianName: row.guardian_name,
      divisionName: row.division_name,
      tryoutNumber: row.tryout_number,
      status: row.checkin_status as 'ready' | 'checked_in' | 'withdrawn' | 'missing_information',
    }));
  }

  async function onCheckIn(input: {
    registrationId: string;
    sessionId?: string;
    groupId?: string;
    requestedNumber?: number;
  }) {
    'use server';
    if (!input.sessionId) throw new Error('A session is required');
    const scoped = await requireCurrentOrganization(organizationSlug);
    const { data: session } = await scoped.client
      .from('tryout_sessions')
      .select('id,division_id')
      .eq('organization_id', scoped.organization.id)
      .eq('tryout_id', tryoutId)
      .eq('id', input.sessionId)
      .maybeSingle();
    if (
      !session ||
      !requireCapability(scoped.authorization, 'checkin:write', {
        organizationId: scoped.organization.id,
        tryoutId,
        divisionId: session.division_id,
        sessionId: session.id,
        groupId: input.groupId,
      }).ok
    )
      throw new Error('Forbidden');
    const { data, error } = await scoped.client.rpc('check_in_registration', {
      p_organization_id: scoped.organization.id,
      p_tryout_id: tryoutId,
      p_registration_id: input.registrationId,
      p_session_id: input.sessionId,
      // PostgreSQL accepts NULL for optional placement/number inputs; generated RPC
      // argument types do not currently preserve input nullability.
      p_group_id: (input.groupId ?? null) as unknown as string,
      p_idempotency_key: randomUUID().replaceAll('-', '').padEnd(32, '0'),
      p_scope_kind: 'division',
      p_requested: (input.requestedNumber ?? null) as unknown as number,
    });
    if (error || !data[0]) throw new Error('Check-in failed');
    return { outcome: data[0].outcome, nextAvailable: data[0].next_available ?? undefined };
  }

  return (
    <section aria-labelledby="checkin-heading" className="min-w-0">
      <p className="eyebrow">Live operations</p>
      <h2 id="checkin-heading">{tryout.name} check-in</h2>
      <p className="mt-2 text-[var(--color-text-muted)]">
        Find a registration, confirm placement, and assign an automatic or requested number.
      </p>
      <div className="mt-6">
        <CheckinWorkspace onCheckIn={onCheckIn} placements={placements} search={search} />
      </div>
    </section>
  );
}
