import { inviteMember } from '@/modules/organizations/application/invite-member';
import { requireCurrentOrganization } from '@/modules/organizations/application/current-organization';
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
  async function invite(
    _previousState: InvitationFormState,
    formData: FormData,
  ): Promise<InvitationFormState> {
    'use server';
    const current = await requireCurrentOrganization(organizationSlug);
    const result = await inviteMember(
      {
        organizationId: current.organization.id,
        email: formData.get('email'),
        role: formData.get('role'),
      },
      { userId: current.userId, authorization: current.authorization },
    );
    if (!result.ok) return { status: 'error', message: 'We could not create that invitation.' };
    return {
      status: result.value.delivery,
      shareUrl: result.value.shareUrl,
      expiresAt: result.value.expiresAt,
    };
  }
  return (
    <section aria-labelledby="members-heading">
      <h2 id="members-heading">Members</h2>
      <p>Invite a staff member with only the role they need.</p>
      {canManageMembers ? (
        <InviteMemberForm action={invite} />
      ) : (
        <p role="alert">You do not have permission to invite members.</p>
      )}
    </section>
  );
}
