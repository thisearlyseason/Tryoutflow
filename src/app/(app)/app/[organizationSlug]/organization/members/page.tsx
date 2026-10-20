import { loadWorkspaceNavigation } from '@/modules/organizations/application/team-workspaces';
import { randomUUID } from 'node:crypto';

import { redirect } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { captureOperationalError } from '@/infrastructure/observability/server-observability';
import { createServerSupabaseClient } from '@/infrastructure/supabase/server';
import { getPublicAppOrigin } from '@/lib/env';
import { DurableInvitationNotifier } from '@/modules/communications/application/queue-communication';
import { inviteMember } from '@/modules/organizations/application/invite-member';
import {
  changeOrganizationMember,
  transferOrganizationOwnership,
} from '@/modules/organizations/application/manage-organization-member';
import { requireCurrentOrganization } from '@/modules/organizations/application/current-organization';
import { AppError } from '@/modules/observability/domain/app-error';
import {
  InviteMemberForm,
  type InvitationFormState,
} from '@/modules/organizations/components/invite-member-form';
import { PageHeader } from '@/components/layout/page-header';

export default async function MembersPage({
  params,
}: {
  params: Promise<{ organizationSlug: string }>;
}) {
  const { organizationSlug } = await params;
  const context = await requireCurrentOrganization(organizationSlug);
  const workspace = await loadWorkspaceNavigation(context.client, context.organization.id);
  const managesParent = workspace.parent?.canManage === true;
  const canManageMembers = ['owner', 'administrator'].includes(
    context.authorization.organizationRole,
  );
  const membersResult = await context.client
    .from('organization_members')
    .select('id,user_id,role,status,version,created_at,inherited_from_organization_id')
    .eq('organization_id', context.organization.id)
    .order('created_at');
  const invitationsResult = canManageMembers
    ? await context.client.rpc('list_organization_invitations', {
        p_organization_id: context.organization.id,
        p_limit: 25,
        p_offset: 0,
      })
    : { data: null, error: null };
  const actorMember = membersResult.data?.find((member) => member.user_id === context.userId);
  if (membersResult.error)
    captureOperationalError(membersResult.error, {
      actorId: context.userId,
      organizationId: context.organization.id,
      operation: 'membership.load',
    });
  async function invite(
    _previousState: InvitationFormState,
    formData: FormData,
  ): Promise<InvitationFormState> {
    'use server';
    const current = await requireCurrentOrganization(organizationSlug);
    const notifier = new DurableInvitationNotifier(
      await createServerSupabaseClient(),
      ({ token, expiresAt }) => ({
        subject: 'You are invited to TryoutFlow',
        text: `Accept your invitation before ${expiresAt.toISOString()}: ${new URL(`/invite/${encodeURIComponent(token)}`, getPublicAppOrigin()).toString()}`,
      }),
    );
    const result = await inviteMember(
      {
        organizationId: current.organization.id,
        email: formData.get('email'),
        role: formData.get('role'),
      },
      { userId: current.userId, authorization: current.authorization },
      { notifier },
    );
    if (!result.ok) return { status: 'error', message: 'We could not create that invitation.' };
    return {
      status: result.value.delivery,
      shareUrl: result.value.shareUrl,
      expiresAt: result.value.expiresAt,
    };
  }

  async function changeMember(formData: FormData) {
    'use server';
    const current = await requireCurrentOrganization(organizationSlug);
    const result = await changeOrganizationMember(
      {
        organizationId: current.organization.id,
        memberId: formData.get('memberId'),
        role: formData.get('role'),
        status: formData.get('status'),
        expectedVersion: Number(formData.get('expectedVersion')),
        idempotencyKey: formData.get('idempotencyKey'),
      },
      { authorization: current.authorization },
    );
    if (!result.ok && result.error.code === 'unavailable')
      captureOperationalError(new AppError('unexpected_error'), {
        actorId: current.userId,
        organizationId: current.organization.id,
        operation: 'membership.change',
      });
    redirect(
      `/app/${organizationSlug}/organization/members?member=${result.ok ? 'updated' : result.error.code}`,
    );
  }

  async function transferOwnership(formData: FormData) {
    'use server';
    const current = await requireCurrentOrganization(organizationSlug);
    const result = await transferOrganizationOwnership(
      {
        organizationId: current.organization.id,
        targetMemberId: formData.get('memberId'),
        expectedActorVersion: Number(formData.get('actorVersion')),
        expectedTargetVersion: Number(formData.get('targetVersion')),
        idempotencyKey: formData.get('idempotencyKey'),
      },
      { authorization: current.authorization },
    );
    if (!result.ok && result.error.code === 'unavailable')
      captureOperationalError(new AppError('unexpected_error'), {
        actorId: current.userId,
        organizationId: current.organization.id,
        operation: 'membership.change',
      });
    redirect(
      `/app/${organizationSlug}/organization/members?ownership=${result.ok ? 'transferred' : result.error.code}`,
    );
  }
  return (
    <section aria-labelledby="members-heading" className="workspace-stack">
      <PageHeader
        description="Invite teammates and control exactly what each person can access."
        eyebrow="Organization"
        title="Members & permissions"
      />
      {workspace.isTeam ? (
        <p className="workspace-card">
          Invite a coach as an Administrator to manage this team, or a Member for assigned
          evaluation and event duties. Invitations grant access to this team only. Organization
          administrators inherit access and are managed in the organization workspace.
        </p>
      ) : null}
      <section aria-labelledby="member-list-heading">
        <h3 id="member-list-heading">Organization access</h3>
        <p className="mt-2 text-[var(--color-text-muted)]">
          Role and access-status changes are applied atomically and recorded in the audit log.
        </p>
        {membersResult.error ? (
          <p className="card mt-4 p-4" role="alert">
            Member access is temporarily unavailable. Refresh before making changes.
          </p>
        ) : membersResult.data?.length ? (
          <ul className="workspace-card-grid mt-4">
            {membersResult.data.map((member) => {
              const isCurrent = member.user_id === context.userId;
              const actorCanChange =
                canManageMembers &&
                !isCurrent &&
                !member.inherited_from_organization_id &&
                member.role !== 'owner' &&
                (context.authorization.organizationRole === 'owner' ||
                  managesParent ||
                  member.role === 'member');
              return (
                <li className="workspace-card grid gap-3" key={member.id}>
                  <div className="min-w-0">
                    <p className="font-semibold">
                      {isCurrent ? 'Your account' : `Member …${member.user_id.slice(-8)}`}
                    </p>
                    <p className="text-sm text-[var(--color-text-muted)]">
                      {workspace.isTeam &&
                      member.role === 'administrator' &&
                      !member.inherited_from_organization_id
                        ? 'Team coach'
                        : member.role}{' '}
                      · {member.status}
                      {member.inherited_from_organization_id ? ' · Managed by organization' : ''}
                    </p>
                  </div>
                  {actorCanChange ? (
                    <div className="flex flex-col gap-3">
                      <form action={changeMember} className="flex flex-wrap items-end gap-2">
                        <input name="expectedVersion" type="hidden" value={member.version} />
                        <input name="idempotencyKey" type="hidden" value={randomUUID()} />
                        <input name="memberId" type="hidden" value={member.id} />
                        <label className="text-sm">
                          Role
                          <select
                            className="block min-h-11 rounded border px-3"
                            defaultValue={member.role}
                            name="role"
                          >
                            <option value="member">Member</option>
                            {context.authorization.organizationRole === 'owner' || managesParent ? (
                              <option value="administrator">Administrator</option>
                            ) : null}
                          </select>
                        </label>
                        <label className="text-sm">
                          Access
                          <select
                            className="block min-h-11 rounded border px-3"
                            defaultValue={member.status}
                            name="status"
                          >
                            <option value="active">Active</option>
                            <option value="disabled">Disabled</option>
                          </select>
                        </label>
                        <Button type="submit">Save access</Button>
                      </form>
                      {!workspace.isTeam &&
                      context.authorization.organizationRole === 'owner' &&
                      member.status === 'active' &&
                      actorMember ? (
                        <form action={transferOwnership}>
                          <input name="actorVersion" type="hidden" value={actorMember.version} />
                          <input name="idempotencyKey" type="hidden" value={randomUUID()} />
                          <input name="memberId" type="hidden" value={member.id} />
                          <input name="targetVersion" type="hidden" value={member.version} />
                          <Button type="submit" variant="secondary">
                            Transfer ownership
                          </Button>
                        </form>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="card mt-4 p-4" role="status">
            No members are visible in this organization.
          </p>
        )}
      </section>
      <section aria-labelledby="invite-heading" className="card p-5">
        {canManageMembers ? (
          <section aria-labelledby="pending-invitations-heading" className="mb-6">
            <h3 id="pending-invitations-heading">Invitations</h3>
            <p className="mt-2 text-[var(--color-text-muted)]">
              Recent invitations stay visible here so you can confirm whether access is still
              pending.
            </p>
            {invitationsResult.error ? (
              <p className="mt-4" role="status">
                Invitation history is temporarily unavailable.
              </p>
            ) : invitationsResult.data?.length ? (
              <ul aria-label="Organization invitations" className="mt-4 grid gap-3">
                {invitationsResult.data.map((invitation) => {
                  const accepted = Boolean(invitation.accepted_at);
                  const expired =
                    !accepted && new Date(invitation.expires_at).getTime() <= Date.now();
                  return (
                    <li
                      className="rounded-[var(--radius-control)] border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-3"
                      key={invitation.id}
                    >
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <p className="break-all font-semibold">{invitation.email}</p>
                        <span className="text-sm text-[var(--color-text-muted)]">
                          {accepted
                            ? 'Accepted'
                            : invitation.revoked_at
                              ? 'Revoked'
                              : expired
                                ? 'Expired'
                                : 'Pending'}
                        </span>
                      </div>
                      <p className="mt-1 text-sm text-[var(--color-text-muted)]">
                        {invitation.role} · Expires{' '}
                        <time dateTime={invitation.expires_at}>
                          {new Intl.DateTimeFormat('en-CA', {
                            dateStyle: 'medium',
                            timeStyle: 'short',
                          }).format(new Date(invitation.expires_at))}
                        </time>
                      </p>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="mt-4" role="status">
                No invitations have been created yet.
              </p>
            )}
          </section>
        ) : null}
        <h3 id="invite-heading">Invite a member</h3>
        <p>Invite a staff member with only the role they need.</p>
        {canManageMembers ? (
          <InviteMemberForm action={invite} />
        ) : (
          <p role="alert">You do not have permission to invite members.</p>
        )}
      </section>
    </section>
  );
}
