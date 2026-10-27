'use server';

import { createHash, randomBytes } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireCurrentOrganization } from '@/modules/organizations/application/current-organization';
import { getPublicAppOrigin } from '@/lib/env';
import { createServerSupabaseClient } from '@/infrastructure/supabase/server';

export async function createFamilyInvitation(slug: string, input: unknown) {
  const parsed = z
    .strictObject({
      athlete_id: z.uuid(),
      email: z
        .email()
        .max(254)
        .transform((email) => email.trim().toLowerCase()),
      relationship: z.enum(['guardian', 'athlete']),
      confirmed: z.literal(true),
    })
    .safeParse(input);
  if (!parsed.success)
    return { ok: false as const, message: 'Choose an athlete and enter the family email.' };
  const c = await requireCurrentOrganization(slug);
  if (!['owner', 'administrator'].includes(c.authorization.organizationRole))
    return { ok: false as const, message: 'Organizer access is required.' };
  const token = randomBytes(32).toString('base64url');
  const shareUrl = new URL(`/invite/family/${token}`, getPublicAppOrigin(process.env)).toString();
  const { error } = await c.client.rpc('create_family_invitation', {
    p_organization_id: c.organization.id,
    p_athlete_id: parsed.data.athlete_id,
    p_email: parsed.data.email,
    p_relationship: parsed.data.relationship,
    p_token_digest: createHash('sha256').update(token).digest('hex'),
  });
  if (error)
    return {
      ok: false as const,
      message: 'The invitation could not be created. Check the athlete and try again.',
    };
  revalidatePath(`/app/${slug}/participants`);
  return {
    ok: true as const,
    shareUrl,
    message:
      'Invitation created. Copy and share it privately with the email you entered. No email has been sent.',
  };
}

export async function revokeFamilyInvitation(slug: string, id: string) {
  if (!z.uuid().safeParse(id).success) return { ok: false, message: 'Invalid invitation.' };
  const c = await requireCurrentOrganization(slug);
  const { data, error } = await c.client.rpc('revoke_family_invitation', {
    p_organization_id: c.organization.id,
    p_invitation_id: id,
  });
  if (error || !data)
    return { ok: false, message: 'Could not revoke this invitation. Refresh and try again.' };
  revalidatePath(`/app/${slug}/participants`);
  return { ok: true, message: 'Invitation revoked.' };
}

export async function acceptFamilyInvitation(token: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return { ok: false };
  const client = await createServerSupabaseClient();
  const { error } = await client.rpc('accept_family_invitation', {
    p_token_digest: createHash('sha256').update(token).digest('hex'),
  });
  if (error) return { ok: false };
  revalidatePath('/participant');
  return { ok: true };
}
