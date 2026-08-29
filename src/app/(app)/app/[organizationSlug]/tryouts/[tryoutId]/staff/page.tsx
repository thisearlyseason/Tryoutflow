import { notFound } from 'next/navigation';
import { z } from 'zod';

import { requireCapability } from '@/modules/organizations/application/require-capability';
import { requireCurrentOrganization } from '@/modules/organizations/application/current-organization';
import { inviteEvaluator } from '@/modules/staffing/application/invite-evaluator';
import { AssignmentWorkspace } from '@/modules/staffing/ui/assignment-workspace';

const actionSchema = z.strictObject({
  evaluatorUserId: z.uuid(),
  scope: z.string().min(1).max(200),
});

export default async function TryoutStaffPage({
  params,
}: {
  params: Promise<{ organizationSlug: string; tryoutId: string }>;
}) {
  const { organizationSlug, tryoutId } = await params;
  const current = await requireCurrentOrganization(organizationSlug);
  const managesTryout = requireCapability(current.authorization, 'tryout:write', {
    organizationId: current.organization.id,
    tryoutId,
  }).ok;
  const managesChildScope = current.authorization.assignments.some(
    (assignment) => assignment.role === 'director' && assignment.scope.tryoutId === tryoutId,
  );
  if (!managesTryout && !managesChildScope) notFound();

  const [{ data: tryout }, { data: divisions }, { data: sessions }, { data: groups }, directory] =
    await Promise.all([
      current.client
        .from('tryouts')
        .select('id,name')
        .eq('organization_id', current.organization.id)
        .eq('id', tryoutId)
        .maybeSingle(),
      current.client
        .from('tryout_divisions')
        .select('id,name')
        .eq('organization_id', current.organization.id)
        .eq('tryout_id', tryoutId)
        .order('sort_order'),
      current.client
        .from('tryout_sessions')
        .select('id,name,division_id')
        .eq('organization_id', current.organization.id)
        .eq('tryout_id', tryoutId)
        .order('starts_at'),
      current.client
        .from('session_groups')
        .select('id,name,session_id')
        .eq('organization_id', current.organization.id)
        .eq('tryout_id', tryoutId)
        .order('sort_order'),
      current.client.rpc('list_tryout_evaluator_candidates', {
        p_organization_id: current.organization.id,
        p_tryout_id: tryoutId,
      }),
    ]);
  if (!tryout) notFound();
  const divisionById = new Map(divisions?.map((division) => [division.id, division.name]));
  const sessionById = new Map(sessions?.map((session) => [session.id, session.name]));
  const scopes = [
    ...(managesTryout
      ? [{ value: `tryout:${tryoutId}`, label: `${tryout.name} — all divisions` }]
      : []),
    ...(divisions?.map((division) => ({
      value: `division:${division.id}`,
      label: `${division.name} division`,
    })) ?? []),
    ...(sessions?.map((session) => ({
      value: `session:${session.id}`,
      label: `${divisionById.get(session.division_id) ?? 'Division'} — ${session.name}`,
    })) ?? []),
    ...(groups?.map((group) => ({
      value: `group:${group.session_id}:${group.id}`,
      label: `${sessionById.get(group.session_id) ?? 'Session'} — ${group.name}`,
    })) ?? []),
  ];

  async function onInvite(email: string) {
    'use server';
    const scoped = await requireCurrentOrganization(organizationSlug);
    const result = await inviteEvaluator(
      { organizationId: scoped.organization.id, email },
      { userId: scoped.userId, authorization: scoped.authorization },
    );
    return result.ok
      ? { outcome: 'invited', shareUrl: result.value.shareUrl }
      : { outcome: result.error.code };
  }

  async function onAssign(input: { evaluatorUserId: string; scope: string }) {
    'use server';
    const parsed = actionSchema.safeParse(input);
    if (!parsed.success) return { outcome: 'invalid_scope' };
    const [kind, firstId, secondId] = parsed.data.scope.split(':');
    const scopeArgs =
      kind === 'tryout' && firstId === tryoutId
        ? {
            p_scope_kind: 'tryout',
            p_division_id: undefined,
            p_session_id: undefined,
            p_group_id: undefined,
          }
        : kind === 'division'
          ? {
              p_scope_kind: 'division',
              p_division_id: firstId,
              p_session_id: undefined,
              p_group_id: undefined,
            }
          : kind === 'session'
            ? {
                p_scope_kind: 'session',
                p_division_id: undefined,
                p_session_id: firstId,
                p_group_id: undefined,
              }
            : kind === 'group'
              ? {
                  p_scope_kind: 'group',
                  p_division_id: undefined,
                  p_session_id: firstId,
                  p_group_id: secondId,
                }
              : null;
    if (!scopeArgs) return { outcome: 'invalid_scope' };
    const scoped = await requireCurrentOrganization(organizationSlug);
    const { data, error } = await scoped.client.rpc('assign_evaluator', {
      p_organization_id: scoped.organization.id,
      p_evaluator_user_id: parsed.data.evaluatorUserId,
      p_tryout_id: tryoutId,
      p_expires_at: undefined,
      ...scopeArgs,
    });
    return { outcome: error ? 'unexpected' : (data[0]?.outcome ?? 'unexpected') };
  }

  return (
    <section aria-labelledby="staffing-heading" className="min-w-0">
      <p className="eyebrow">Tryout staffing</p>
      <h2 id="staffing-heading">{tryout.name} evaluators</h2>
      <p className="mt-2 max-w-3xl text-[var(--color-text-muted)]">
        Invite organization members, then grant only the division, session, or group they evaluate.
      </p>
      <div className="mt-6">
        <AssignmentWorkspace
          canInvite={
            requireCapability(current.authorization, 'membership:manage', {
              organizationId: current.organization.id,
            }).ok
          }
          evaluators={(directory.data ?? []).map((evaluator) => ({
            userId: evaluator.evaluator_user_id,
            displayName: evaluator.display_name,
          }))}
          onAssign={onAssign}
          onInvite={onInvite}
          scopes={scopes}
        />
      </div>
    </section>
  );
}
