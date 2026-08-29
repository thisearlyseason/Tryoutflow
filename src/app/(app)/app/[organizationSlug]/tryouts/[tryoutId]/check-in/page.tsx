import { createHash } from 'node:crypto';

import { notFound } from 'next/navigation';
import { z } from 'zod';

import { CheckinWorkspace } from '@/modules/checkin/ui/checkin-workspace';
import { requireCapability } from '@/modules/organizations/application/require-capability';
import { requireCurrentOrganization } from '@/modules/organizations/application/current-organization';

const searchSchema = z.strictObject({
  query: z.string().trim().min(2).max(120),
  sessionId: z.uuid(),
  groupId: z.uuid().optional(),
});
const checkinSchema = z.strictObject({
  registrationId: z.uuid(),
  sessionId: z.uuid(),
  groupId: z.uuid().optional(),
  requestedNumber: z.int().min(1).max(9999).optional(),
  requestKey: z.uuid(),
  numberScope: z.enum(['session', 'group']),
});

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
  type Placement = {
    sessionId: string;
    sessionName: string;
    groupId?: string;
    groupName?: string;
    numberScope: 'session' | 'group';
  };
  const placements =
    sessions?.flatMap<Placement>((session) => {
      const groups = session.session_groups;
      if (groups.length === 0) {
        return requireCapability(current.authorization, 'checkin:read', {
          organizationId: current.organization.id,
          tryoutId,
          divisionId: session.division_id,
          sessionId: session.id,
        }).ok
          ? [{ sessionId: session.id, sessionName: session.name, numberScope: 'session' as const }]
          : [];
      }
      return groups.flatMap((group) =>
        requireCapability(current.authorization, 'checkin:read', {
          organizationId: current.organization.id,
          tryoutId,
          divisionId: session.division_id,
          sessionId: session.id,
          groupId: group.id,
        }).ok
          ? [
              {
                sessionId: session.id,
                sessionName: session.name,
                groupId: group.id,
                groupName: group.name,
                numberScope: 'group' as const,
              },
            ]
          : [],
      );
    }) ?? [];
  if (placements.length === 0) notFound();

  async function search(query: string, placement?: { sessionId: string; groupId?: string }) {
    'use server';
    const parsed = searchSchema.safeParse({ query, ...placement });
    if (!parsed.success) return { outcome: 'invalid_request' as const, results: [] };
    const scoped = await requireCurrentOrganization(organizationSlug);
    const rateKey = createHash('sha256')
      .update(`${scoped.userId}:${scoped.organization.id}:${tryoutId}:checkin-search`)
      .digest('hex');
    const { data, error } = await scoped.client.rpc('search_checkin_registrations_v2', {
      p_organization_id: scoped.organization.id,
      p_tryout_id: tryoutId,
      p_session_id: parsed.data.sessionId,
      p_group_id: (parsed.data.groupId ?? null) as unknown as string,
      p_query: parsed.data.query,
      p_limit: 25,
      p_rate_key_hash: rateKey,
    });
    if (error) return { outcome: 'invalid_request' as const, results: [] };
    const first = data[0];
    if (!first) return { outcome: 'ok' as const, results: [] };
    if (first.outcome !== 'ok') {
      return {
        outcome: first.outcome as 'rate_limited' | 'forbidden' | 'invalid_request',
        results: [],
      };
    }
    return {
      outcome: 'ok' as const,
      results: data.map((row) => ({
        registrationId: row.registration_id,
        athleteName: row.athlete_name,
        guardianName: row.guardian_name,
        divisionName: row.division_name,
        tryoutNumber: row.tryout_number,
        status: row.checkin_status as
          'ready' | 'checked_in' | 'withdrawn' | 'cancelled' | 'missing_information',
      })),
    };
  }

  async function onCheckIn(input: {
    registrationId: string;
    sessionId?: string;
    groupId?: string;
    requestedNumber?: number;
    requestKey: string;
    numberScope?: 'session' | 'group';
  }) {
    'use server';
    const parsed = checkinSchema.safeParse(input);
    if (!parsed.success) return { outcome: 'invalid_request' as const };
    const scoped = await requireCurrentOrganization(organizationSlug);
    const { data: session } = await scoped.client
      .from('tryout_sessions')
      .select('id,division_id')
      .eq('organization_id', scoped.organization.id)
      .eq('tryout_id', tryoutId)
      .eq('id', parsed.data.sessionId)
      .maybeSingle();
    if (
      !session ||
      !requireCapability(scoped.authorization, 'checkin:write', {
        organizationId: scoped.organization.id,
        tryoutId,
        divisionId: session.division_id,
        sessionId: session.id,
        groupId: parsed.data.groupId,
      }).ok
    )
      return { outcome: 'forbidden' as const };
    const { data, error } = await scoped.client.rpc('check_in_registration_v2', {
      p_organization_id: scoped.organization.id,
      p_tryout_id: tryoutId,
      p_registration_id: parsed.data.registrationId,
      p_session_id: parsed.data.sessionId,
      // PostgreSQL accepts NULL for optional placement/number inputs; generated RPC
      // argument types do not currently preserve input nullability.
      p_group_id: (parsed.data.groupId ?? null) as unknown as string,
      p_idempotency_key: parsed.data.requestKey,
      p_scope_kind: parsed.data.numberScope,
      p_requested: (parsed.data.requestedNumber ?? null) as unknown as number,
    });
    if (error || !data[0]) return { outcome: 'invalid_request' as const };
    return {
      outcome: data[0].outcome as
        | 'checked_in'
        | 'already_checked_in'
        | 'number_conflict'
        | 'capacity'
        | 'withdrawn'
        | 'cancelled'
        | 'missing_information'
        | 'invalid_registration'
        | 'invalid_placement'
        | 'forbidden'
        | 'invalid_request'
        | 'exhausted'
        | 'conflict',
      receiptId: data[0].receipt_id ?? undefined,
      checkedInAt: data[0].checked_in_at ?? undefined,
      assignedNumber: data[0].assigned_number ?? undefined,
      nextAvailable: data[0].next_available ?? undefined,
    };
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
