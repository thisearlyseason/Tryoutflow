import { redirect } from 'next/navigation';

import { inviteMember } from '@/modules/organizations/application/invite-member';
import { requireCurrentOrganization } from '@/modules/organizations/application/current-organization';

export default async function MembersPage({
  params,
}: {
  params: Promise<{ organizationSlug: string }>;
}) {
  const { organizationSlug } = await params;
  const context = await requireCurrentOrganization(organizationSlug);
  async function invite(formData: FormData) {
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
    redirect(
      `/app/${organizationSlug}/organization/members?${result.ok ? 'invited=1' : `error=${result.error.code}`}`,
    );
  }
  return (
    <section aria-labelledby="members-heading">
      <h2 id="members-heading">Members</h2>
      <p>Invite a staff member with only the role they need.</p>
      <form action={invite}>
        <label htmlFor="email">Email</label>
        <input autoComplete="email" id="email" name="email" required type="email" />
        <label htmlFor="role">Role</label>
        <select defaultValue="member" id="role" name="role">
          <option value="member">Member</option>
          <option value="administrator">Administrator</option>
        </select>
        <button type="submit">Send invitation</button>
      </form>
      {context.authorization.organizationRole === 'member' ? (
        <p role="alert">You do not have permission to invite members.</p>
      ) : null}
    </section>
  );
}
