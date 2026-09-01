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

export default async function MembersPage({
  params,
}: {
  params: Promise<{ organizationSlug: string }>;
}) {
  const { organizationSlug } = await params;
  const context = await requireCurrentOrganization(organizationSlug);
  const canManageMembers = ['owner', 'administrator'].includes(
    context.authorization.organizationRole,
  );
  const membersResult = await context.client
    .from('organization_members')
    .select('id,user_id,role,status,version,created_at')
    .eq('organization_id', context.organization.id)
    .order('created_at');
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
    <section aria-labelledby="members-heading" className="grid gap-8">
      <h2 id="members-heading">Members</h2>
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
          <ul className="mt-4 grid gap-3">
            {membersResult.data.map((member) => {
              const isCurrent = member.user_id === context.userId;
              const actorCanChange =
                canManageMembers &&
                !isCurrent &&
                member.role !== 'owner' &&
                (context.authorization.organizationRole === 'owner' || member.role === 'member');
              return (
                <li className="card grid gap-3 p-4 lg:grid-cols-[1fr_auto]" key={member.id}>
                  <div className="min-w-0">
                    <p className="font-semibold">
                      {isCurrent ? 'Your account' : `Member …${member.user_id.slice(-8)}`}
                    </p>
                    <p className="text-sm text-[var(--color-text-muted)]">
                      {member.role} · {member.status}
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
                            {context.authorization.organizationRole === 'owner' ? (
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
                      {context.authorization.organizationRole === 'owner' &&
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
